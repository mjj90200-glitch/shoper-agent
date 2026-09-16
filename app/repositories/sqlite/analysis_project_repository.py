"""analysis_projects 表的全部 SQL；事务由调用方（服务层）编排。"""

import sqlite3


class AnalysisProjectRepository:
    def list_for_user(
        self, connection: sqlite3.Connection, username: str, limit: int = 100
    ) -> list[sqlite3.Row]:
        return connection.execute(
            "SELECT project_json FROM analysis_projects WHERE username=? ORDER BY updated_at DESC LIMIT ?",
            (username, limit),
        ).fetchall()

    def get(
        self, connection: sqlite3.Connection, username: str, project_id: str
    ) -> sqlite3.Row | None:
        return connection.execute(
            "SELECT project_json FROM analysis_projects WHERE username=? AND project_id=?",
            (username, project_id),
        ).fetchone()

    def upsert(
        self,
        connection: sqlite3.Connection,
        username: str,
        project_id: str,
        title: str,
        status: str,
        updated_at: int,
        payload: str,
    ) -> None:
        connection.execute(
            """INSERT INTO analysis_projects
               (username, project_id, title, status, updated_at, project_json)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(username, project_id) DO UPDATE SET
                 title=excluded.title, status=excluded.status,
                 updated_at=excluded.updated_at, project_json=excluded.project_json""",
            (username, project_id, title, status, updated_at, payload),
        )

    def list_running(self, connection: sqlite3.Connection) -> list[sqlite3.Row]:
        return connection.execute(
            "SELECT username, project_json FROM analysis_projects WHERE status='running'"
        ).fetchall()

    def update_status_and_payload(
        self,
        connection: sqlite3.Connection,
        username: str,
        project_id: str,
        status: str,
        payload: str,
    ) -> None:
        connection.execute(
            "UPDATE analysis_projects SET status=?, project_json=? WHERE username=? AND project_id=?",
            (status, payload, username, project_id),
        )

    def delete(
        self, connection: sqlite3.Connection, username: str, project_id: str
    ) -> bool:
        result = connection.execute(
            "DELETE FROM analysis_projects WHERE username=? AND project_id=?",
            (username, project_id),
        )
        return result.rowcount == 1
