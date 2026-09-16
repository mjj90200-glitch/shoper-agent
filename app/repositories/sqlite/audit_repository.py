"""query_audit_log 表的全部 SQL；事务由调用方（服务层）编排。"""

import sqlite3

from app.entities.audit_record import QueryAuditRecord


def row_to_dict(row: sqlite3.Row) -> dict:
    """把数据库行转成对外结构；sql_text 列在对外结构中叫 sql。"""

    data = dict(row)
    data["sql"] = data.pop("sql_text")
    return data


class AuditRepository:
    def insert_running(self, connection: sqlite3.Connection, record: QueryAuditRecord) -> None:
        connection.execute(
            """INSERT INTO query_audit_log VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, 'running', NULL, NULL, NULL, NULL, ?, NULL)""",
            (record.id, record.username, record.session_id, record.query, record.started_at),
        )

    def update_from_record(self, connection: sqlite3.Connection, record: QueryAuditRecord) -> None:
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

    def get(self, connection: sqlite3.Connection, audit_id: str) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT * FROM query_audit_log WHERE id=?", (audit_id,)
        ).fetchone()

    def get_for_user(
        self, connection: sqlite3.Connection, audit_id: str, username: str
    ) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT * FROM query_audit_log WHERE id=? AND username=?", (audit_id, username)
        ).fetchone()

    def update_feedback(
        self,
        connection: sqlite3.Connection,
        audit_id: str,
        score: str,
        comment: str | None,
        feedback_at: str,
    ) -> None:
        connection.execute(
            "UPDATE query_audit_log SET feedback_score=?, feedback_comment=?, feedback_at=? WHERE id=?",
            (score, comment, feedback_at, audit_id),
        )

    def list_for_user(
        self, connection: sqlite3.Connection, username: str, limit: int
    ) -> list[dict]:
        rows = connection.execute(
            "SELECT * FROM query_audit_log WHERE username=? ORDER BY started_at DESC LIMIT ?",
            (username, limit),
        ).fetchall()
        return [row_to_dict(row) for row in rows]

    def list_all(self, connection: sqlite3.Connection) -> list[dict]:
        rows = connection.execute("SELECT * FROM query_audit_log").fetchall()
        return [row_to_dict(row) for row in rows]

    def list_for_session(
        self, connection: sqlite3.Connection, username: str, session_id: str
    ) -> list[dict]:
        rows = connection.execute(
            "SELECT * FROM query_audit_log WHERE username=? AND session_id=? ORDER BY started_at",
            (username, session_id),
        ).fetchall()
        return [row_to_dict(row) for row in rows]

    def delete_for_session(
        self, connection: sqlite3.Connection, username: str, session_id: str
    ) -> None:
        connection.execute(
            "DELETE FROM query_audit_log WHERE username=? AND session_id=?",
            (username, session_id),
        )
