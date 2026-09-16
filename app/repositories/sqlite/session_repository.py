"""chat_sessions 表的全部 SQL；事务由调用方（服务层）编排。"""

import sqlite3
from datetime import UTC, datetime


class SessionRepository:
    def upsert_for_query(
        self, connection: sqlite3.Connection, username: str, session_id: str, title: str, now: str
    ) -> None:
        connection.execute(
            """INSERT INTO chat_sessions (username, session_id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(username, session_id) DO UPDATE SET updated_at=excluded.updated_at""",
            (username, session_id, title, now, now),
        )

    def touch(self, connection: sqlite3.Connection, username: str, session_id: str) -> None:
        connection.execute(
            "UPDATE chat_sessions SET updated_at=? WHERE username=? AND session_id=?",
            (datetime.now(UTC).isoformat(), username, session_id),
        )

    def exists(self, connection: sqlite3.Connection, username: str, session_id: str) -> bool:
        return (
            connection.execute(
                "SELECT 1 FROM chat_sessions WHERE username=? AND session_id=?",
                (username, session_id),
            ).fetchone()
            is not None
        )

    def list_for_user(
        self, connection: sqlite3.Connection, username: str, limit: int
    ) -> list[dict]:
        rows = connection.execute(
            "SELECT session_id, title, created_at, updated_at FROM chat_sessions"
            " WHERE username=? ORDER BY updated_at DESC LIMIT ?",
            (username, limit),
        ).fetchall()
        return [dict(row) for row in rows]

    def rename(
        self, connection: sqlite3.Connection, username: str, session_id: str, title: str
    ) -> bool:
        result = connection.execute(
            "UPDATE chat_sessions SET title=?, updated_at=? WHERE username=? AND session_id=?",
            (title.strip(), datetime.now(UTC).isoformat(), username, session_id),
        )
        return result.rowcount == 1

    def delete(self, connection: sqlite3.Connection, username: str, session_id: str) -> bool:
        result = connection.execute(
            "DELETE FROM chat_sessions WHERE username=? AND session_id=?",
            (username, session_id),
        )
        return result.rowcount == 1
