"""本地 SQLite 问数审计、反馈和会话元数据服务。"""

import sqlite3
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from time import perf_counter
from uuid import uuid4


@dataclass
class QueryAuditRecord:
    id: str
    username: str
    session_id: str
    query: str
    resolved_query: str | None
    sql: str | None
    result_row_count: int | None
    terminal_type: str | None
    status: str
    error: str | None
    feedback_score: str | None
    feedback_comment: str | None
    feedback_at: str | None
    started_at: str
    duration_ms: int | None
    _started_monotonic: float

    def to_dict(self) -> dict:
        data = asdict(self)
        data.pop("_started_monotonic")
        return data


class QueryAuditService:
    """默认内存运行；应用启动后切换到 SQLite 持久化。"""

    def __init__(self, max_records: int = 500):
        self._max_records = max_records
        self._records: list[QueryAuditRecord] = []
        self._database_path: Path | None = None
        self._lock = Lock()

    def configure_database(self, database_path: Path) -> None:
        """初始化本地持久化表；每次操作短连接，避免跨事件循环持有连接。"""

        database_path.parent.mkdir(parents=True, exist_ok=True)
        self._database_path = database_path
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    username TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (username, session_id)
                );
                CREATE TABLE IF NOT EXISTS query_audit_log (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    query TEXT NOT NULL,
                    resolved_query TEXT,
                    sql_text TEXT,
                    result_row_count INTEGER,
                    terminal_type TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    feedback_score TEXT,
                    feedback_comment TEXT,
                    feedback_at TEXT,
                    started_at TEXT NOT NULL,
                    duration_ms INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_audit_user_started
                    ON query_audit_log (username, started_at DESC);
                """
            )

    def _connect(self) -> sqlite3.Connection:
        if self._database_path is None:
            raise RuntimeError("审计数据库尚未初始化。")
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def start(self, username: str, session_id: str, query: str) -> QueryAuditRecord:
        now = datetime.now(UTC).isoformat()
        record = QueryAuditRecord(
            id=str(uuid4()), username=username, session_id=session_id, query=query,
            resolved_query=None, sql=None, result_row_count=None, terminal_type=None,
            status="running", error=None, feedback_score=None, feedback_comment=None,
            feedback_at=None, started_at=now, duration_ms=None,
            _started_monotonic=perf_counter(),
        )
        with self._lock:
            if self._database_path is None:
                self._records.append(record)
                self._records = self._records[-self._max_records :]
            else:
                with self._connect() as connection:
                    connection.execute(
                        """INSERT INTO chat_sessions (username, session_id, title, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(username, session_id) DO UPDATE SET updated_at=excluded.updated_at""",
                        (username, session_id, query[:40], now, now),
                    )
                    connection.execute(
                        """INSERT INTO query_audit_log VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 'running', NULL, NULL, NULL, NULL, ?, NULL)""",
                        (record.id, username, session_id, query, now),
                    )
        return record

    def observe(self, record: QueryAuditRecord, event: dict) -> None:
        """从 SSE 业务事件补齐审计字段，不保存完整查询结果。"""

        event_type = event.get("type")
        if event_type == "query_context":
            record.resolved_query = event.get("resolved_query")
        elif event_type == "sql":
            record.sql = event.get("sql")
        elif event_type == "result":
            data = event.get("data")
            record.result_row_count = len(data) if isinstance(data, list) else None
            record.terminal_type, record.status = "result", "succeeded"
        elif event_type == "assistant_message":
            record.terminal_type, record.status = "assistant_message", "succeeded"
        elif event_type == "error":
            record.terminal_type, record.status = "error", "failed"
            record.error = str(event.get("message", "未知错误"))
        else:
            return
        self._save_record(record)

    def finish(self, record: QueryAuditRecord) -> None:
        if record.status == "running":
            record.status, record.error = "failed", "请求未完成或连接已中断。"
        record.duration_ms = round((perf_counter() - record._started_monotonic) * 1000)
        self._save_record(record)

    def _save_record(self, record: QueryAuditRecord) -> None:
        with self._lock:
            if self._database_path is None:
                return
            with self._connect() as connection:
                connection.execute(
                    """UPDATE query_audit_log SET resolved_query=?, sql_text=?, result_row_count=?,
                    terminal_type=?, status=?, error=?, feedback_score=?, feedback_comment=?,
                    feedback_at=?, duration_ms=? WHERE id=?""",
                    (
                        record.resolved_query, record.sql, record.result_row_count,
                        record.terminal_type, record.status, record.error,
                        record.feedback_score, record.feedback_comment, record.feedback_at,
                        record.duration_ms, record.id,
                    ),
                )
                connection.execute(
                    "UPDATE chat_sessions SET updated_at=? WHERE username=? AND session_id=?",
                    (datetime.now(UTC).isoformat(), record.username, record.session_id),
                )

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        data = dict(row)
        data["sql"] = data.pop("sql_text")
        return data

    def list_for_user(self, username: str, limit: int = 30) -> list[dict]:
        with self._lock:
            if self._database_path is None:
                return [record.to_dict() for record in reversed([r for r in self._records if r.username == username][-limit:])]
            with self._connect() as connection:
                rows = connection.execute(
                    "SELECT * FROM query_audit_log WHERE username=? ORDER BY started_at DESC LIMIT ?",
                    (username, limit),
                ).fetchall()
                return [self._row_to_dict(row) for row in rows]

    def submit_feedback(self, audit_id: str, username: str, score: str, comment: str | None) -> dict | None:
        with self._lock:
            if self._database_path is None:
                record = next((r for r in self._records if r.id == audit_id and r.username == username), None)
                if record is None or record.status == "running":
                    return None
                record.feedback_score, record.feedback_comment = score, comment.strip() if comment else None
                record.feedback_at = datetime.now(UTC).isoformat()
                return record.to_dict()
            with self._connect() as connection:
                row = connection.execute("SELECT * FROM query_audit_log WHERE id=? AND username=?", (audit_id, username)).fetchone()
                if row is None or row["status"] == "running":
                    return None
                feedback_at = datetime.now(UTC).isoformat()
                connection.execute("UPDATE query_audit_log SET feedback_score=?, feedback_comment=?, feedback_at=? WHERE id=?", (score, comment.strip() if comment else None, feedback_at, audit_id))
                row = connection.execute("SELECT * FROM query_audit_log WHERE id=?", (audit_id,)).fetchone()
                return self._row_to_dict(row)

    def quality_summary(self) -> dict:
        with self._lock:
            if self._database_path is None:
                rows = [record.to_dict() for record in self._records]
            else:
                with self._connect() as connection:
                    rows = [self._row_to_dict(row) for row in connection.execute("SELECT * FROM query_audit_log").fetchall()]
        completed = [row for row in rows if row["status"] != "running"]
        succeeded = [row for row in completed if row["status"] == "succeeded"]
        feedbacks = [row for row in completed if row["feedback_score"]]
        negative = [row for row in feedbacks if row["feedback_score"] == "down"]
        durations = [row["duration_ms"] for row in completed if row["duration_ms"] is not None]
        return {
            "total_queries": len(rows), "completed_queries": len(completed),
            "success_rate": len(succeeded) / len(completed) if completed else 0,
            "average_duration_ms": round(sum(durations) / len(durations)) if durations else 0,
            "feedback_count": len(feedbacks),
            "helpful_rate": sum(row["feedback_score"] == "up" for row in feedbacks) / len(feedbacks) if feedbacks else 0,
            "negative_feedback": [
                {key: row[key] for key in ("id", "username", "query", "feedback_comment", "started_at")}
                for row in negative[-10:][::-1]
            ],
        }

    def list_sessions(self, username: str, limit: int = 50) -> list[dict]:
        if self._database_path is None:
            return []
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT session_id, title, created_at, updated_at FROM chat_sessions WHERE username=? ORDER BY updated_at DESC LIMIT ?",
                (username, limit),
            ).fetchall()
            return [dict(row) for row in rows]

    def list_for_session(self, username: str, session_id: str) -> list[dict] | None:
        if self._database_path is None:
            return None
        with self._lock, self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM chat_sessions WHERE username=? AND session_id=?",
                (username, session_id),
            ).fetchone()
            if exists is None:
                return None
            rows = connection.execute(
                "SELECT * FROM query_audit_log WHERE username=? AND session_id=? ORDER BY started_at",
                (username, session_id),
            ).fetchall()
            return [self._row_to_dict(row) for row in rows]

    def rename_session(self, username: str, session_id: str, title: str) -> bool:
        if self._database_path is None:
            return False
        with self._lock, self._connect() as connection:
            result = connection.execute(
                "UPDATE chat_sessions SET title=?, updated_at=? WHERE username=? AND session_id=?",
                (title.strip(), datetime.now(UTC).isoformat(), username, session_id),
            )
            return result.rowcount == 1

    def delete_session(self, username: str, session_id: str) -> bool:
        if self._database_path is None:
            return False
        with self._lock, self._connect() as connection:
            connection.execute(
                "DELETE FROM query_audit_log WHERE username=? AND session_id=?",
                (username, session_id),
            )
            result = connection.execute(
                "DELETE FROM chat_sessions WHERE username=? AND session_id=?",
                (username, session_id),
            )
            return result.rowcount == 1


query_audit_service = QueryAuditService()
