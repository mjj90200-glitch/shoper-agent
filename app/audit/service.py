"""本地 SQLite 问数审计、反馈和会话元数据服务。

服务层只编排业务规则（内存兜底、状态流转、汇总口径）；
chat_sessions 与 query_audit_log 的 SQL 分别由 SessionRepository 和
AuditRepository 提供，建表由 lifespan 的迁移机制统一完成。
"""

from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from time import perf_counter
from uuid import uuid4

from app.db.migrations import apply_migrations
from app.entities.audit_record import QueryAuditRecord
from app.repositories.sqlite.audit_repository import AuditRepository, row_to_dict
from app.repositories.sqlite.connection import open_connection
from app.repositories.sqlite.session_repository import SessionRepository


class QueryAuditService:
    """默认内存运行；应用启动后切换到 SQLite 持久化。"""

    def __init__(self, max_records: int = 500):
        self._max_records = max_records
        self._records: list[QueryAuditRecord] = []
        self._database_path: Path | None = None
        self._lock = Lock()
        self._audit_repo = AuditRepository()
        self._session_repo = SessionRepository()

    def configure_database(self, database_path: Path) -> None:
        """接入持久化库；建表与结构升级统一由迁移机制处理。"""

        apply_migrations(database_path)
        self._database_path = database_path

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
                # 会话元数据和审计记录同事务写入，保证两者一致
                with open_connection(self._database_path) as connection:
                    self._session_repo.upsert_for_query(
                        connection, username, session_id, query[:40], now
                    )
                    self._audit_repo.insert_running(connection, record)
        return record

    def observe(self, record: QueryAuditRecord, event: dict) -> None:
        """从 SSE 业务事件补齐审计字段与步骤耗时，不保存完整查询结果。"""

        event_type = event.get("type")
        if event_type == "progress":
            record.note_step_event(event)
            return
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
            record.error_code = str(event.get("code") or "query_failed")
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
            with open_connection(self._database_path) as connection:
                self._audit_repo.update_from_record(connection, record)
                self._session_repo.touch(connection, record.username, record.session_id)

    def list_for_user(self, username: str, limit: int = 30) -> list[dict]:
        with self._lock:
            if self._database_path is None:
                return [record.to_dict() for record in reversed([r for r in self._records if r.username == username][-limit:])]
            with open_connection(self._database_path) as connection:
                return self._audit_repo.list_for_user(connection, username, limit)

    def submit_feedback(self, audit_id: str, username: str, score: str, comment: str | None) -> dict | None:
        with self._lock:
            if self._database_path is None:
                record = next((r for r in self._records if r.id == audit_id and r.username == username), None)
                if record is None or record.status == "running":
                    return None
                record.feedback_score, record.feedback_comment = score, comment.strip() if comment else None
                record.feedback_at = datetime.now(UTC).isoformat()
                return record.to_dict()
            with open_connection(self._database_path) as connection:
                row = self._audit_repo.get_for_user(connection, audit_id, username)
                if row is None or row["status"] == "running":
                    return None
                feedback_at = datetime.now(UTC).isoformat()
                self._audit_repo.update_feedback(
                    connection, audit_id, score, comment.strip() if comment else None, feedback_at
                )
                return row_to_dict(self._audit_repo.get(connection, audit_id))

    @staticmethod
    def _percentile(sorted_values: list[int], fraction: float) -> int:
        """最近邻秩百分位；空列表返回 0。"""

        if not sorted_values:
            return 0
        import math

        rank = max(1, math.ceil(fraction * len(sorted_values)))
        return sorted_values[rank - 1]

    def quality_summary(self) -> dict:
        with self._lock:
            if self._database_path is None:
                rows = [record.to_dict() for record in self._records]
            else:
                with open_connection(self._database_path) as connection:
                    rows = self._audit_repo.list_all(connection)
        completed = [row for row in rows if row["status"] != "running"]
        succeeded = [row for row in completed if row["status"] == "succeeded" and row["terminal_type"] == "result"]
        feedbacks = [row for row in completed if row["feedback_score"]]
        negative = [row for row in feedbacks if row["feedback_score"] == "down"]
        # 延迟口径：只统计成功查询（快速失败的拒答不参与延迟分位，P3-B 标准口径）
        durations = sorted(
            row["duration_ms"]
            for row in completed
            if row["duration_ms"] is not None and row["terminal_type"] == "result"
        )

        # 失败分类：业务拒答、SQL 被拒、依赖失败等按稳定码聚合（P3-B）
        breakdown: dict[str, int] = {}
        for row in completed:
            if row["terminal_type"] == "assistant_message":
                breakdown["assistant_message"] = breakdown.get("assistant_message", 0) + 1
            elif row["status"] == "failed":
                code = row.get("error_code") or "unknown"
                breakdown[code] = breakdown.get(code, 0) + 1

        return {
            "total_queries": len(rows), "completed_queries": len(completed),
            "success_rate": len(succeeded) / len(completed) if completed else 0,
            "average_duration_ms": round(sum(durations) / len(durations)) if durations else 0,
            "p50_duration_ms": self._percentile(durations, 0.50),
            "p95_duration_ms": self._percentile(durations, 0.95),
            "failure_breakdown": breakdown,
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
        with self._lock, open_connection(self._database_path) as connection:
            return self._session_repo.list_for_user(connection, username, limit)

    def list_for_session(self, username: str, session_id: str) -> list[dict] | None:
        if self._database_path is None:
            return None
        with self._lock, open_connection(self._database_path) as connection:
            if not self._session_repo.exists(connection, username, session_id):
                return None
            return self._audit_repo.list_for_session(connection, username, session_id)

    def rename_session(self, username: str, session_id: str, title: str) -> bool:
        if self._database_path is None:
            return False
        with self._lock, open_connection(self._database_path) as connection:
            return self._session_repo.rename(connection, username, session_id, title)

    def delete_session(self, username: str, session_id: str) -> bool:
        if self._database_path is None:
            return False
        with self._lock, open_connection(self._database_path) as connection:
            # 会话删除同时清理其审计记录，两表同一事务
            self._audit_repo.delete_for_session(connection, username, session_id)
            return self._session_repo.delete(connection, username, session_id)


query_audit_service = QueryAuditService()
