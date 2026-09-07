"""数据分析项目的应用级 SQLite 持久化。"""

import json
import sqlite3
from contextlib import closing
from pathlib import Path
from threading import Lock


class AnalysisProjectService:
    def __init__(self):
        self._database_path: Path | None = None
        self._lock = Lock()

    def configure_database(self, database_path: Path) -> None:
        self._database_path = database_path
        with closing(self._connect()) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS analysis_projects (
                    username TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    status TEXT NOT NULL,
                    updated_at INTEGER NOT NULL,
                    project_json TEXT NOT NULL,
                    PRIMARY KEY (username, project_id)
                );
                CREATE INDEX IF NOT EXISTS idx_analysis_projects_user_updated
                    ON analysis_projects (username, updated_at DESC);
                PRAGMA optimize;
                """
            )

    def _connect(self) -> sqlite3.Connection:
        if self._database_path is None:
            raise RuntimeError("分析项目数据库尚未初始化。")
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def list(self, username: str) -> list[dict]:
        with self._lock, closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT project_json FROM analysis_projects WHERE username=? ORDER BY updated_at DESC LIMIT 100",
                (username,),
            ).fetchall()
        return [json.loads(row["project_json"]) for row in rows]

    def save(self, username: str, project: dict) -> dict:
        payload = json.dumps(project, ensure_ascii=False, default=str)
        if len(payload.encode("utf-8")) > 2_000_000:
            raise ValueError("分析项目数据超过 2MB，请减少结果明细后重试。")
        with self._lock, closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO analysis_projects
                   (username, project_id, title, status, updated_at, project_json)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(username, project_id) DO UPDATE SET
                     title=excluded.title, status=excluded.status,
                     updated_at=excluded.updated_at, project_json=excluded.project_json""",
                (username, project["id"], project["title"], project["status"], project["updatedAt"], payload),
            )
            connection.commit()
        return project

    def delete(self, username: str, project_id: str) -> bool:
        with self._lock, closing(self._connect()) as connection:
            result = connection.execute(
                "DELETE FROM analysis_projects WHERE username=? AND project_id=?",
                (username, project_id),
            )
            connection.commit()
            return result.rowcount == 1


analysis_project_service = AnalysisProjectService()
