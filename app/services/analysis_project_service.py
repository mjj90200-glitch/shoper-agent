"""数据分析项目的应用级 SQLite 持久化。

服务层保留业务规则（2MB 上限、运行中任务的写入权、中断恢复）；
analysis_projects 的 SQL 由 AnalysisProjectRepository 提供，
建表由 lifespan 的迁移机制统一完成。
"""

import json
from copy import deepcopy
from pathlib import Path
from threading import Lock

from app.db.migrations import apply_migrations
from app.repositories.sqlite.analysis_project_repository import (
    AnalysisProjectRepository,
)
from app.repositories.sqlite.connection import open_connection

MAX_PROJECT_BYTES = 2_000_000


class AnalysisProjectService:
    def __init__(self):
        self._database_path: Path | None = None
        self._lock = Lock()
        self._repo = AnalysisProjectRepository()

    def configure_database(self, database_path: Path) -> None:
        """接入持久化库；建表与结构升级统一由迁移机制处理。"""

        apply_migrations(database_path)
        self._database_path = database_path

    def list(self, username: str) -> list[dict]:
        with self._lock, open_connection(self._database_path) as connection:
            rows = self._repo.list_for_user(connection, username)
        return [json.loads(row["project_json"]) for row in rows]

    def get(self, username: str, project_id: str) -> dict | None:
        with self._lock, open_connection(self._database_path) as connection:
            row = self._repo.get(connection, username, project_id)
        return json.loads(row["project_json"]) if row else None

    def save(self, username: str, project: dict) -> dict:
        payload = json.dumps(project, ensure_ascii=False, default=str)
        if len(payload.encode("utf-8")) > MAX_PROJECT_BYTES:
            raise ValueError("分析项目数据超过 2MB，请减少结果明细后重试。")
        with self._lock, open_connection(self._database_path) as connection:
            self._repo.upsert(
                connection,
                username,
                str(project["id"]),
                project["title"],
                project["status"],
                project["updatedAt"],
                payload,
            )
        return project

    def save_from_client(self, username: str, project: dict) -> dict:
        """运行中的服务端任务拥有写入权，防止浏览器旧快照覆盖最新步骤。"""

        current = self.get(username, str(project["id"]))
        if current and current.get("status") == "running":
            return current
        return self.save(username, project)

    def recover_interrupted(self) -> int:
        """服务重启后把失去执行协程的任务恢复成可以继续的状态。"""

        recovered = 0
        with self._lock, open_connection(self._database_path) as connection:
            rows = self._repo.list_running(connection)
            for row in rows:
                project = json.loads(row["project_json"])
                project["status"] = "review"
                project["runs"] = [
                    {
                        **run,
                        "status": "pending" if run.get("status") == "running" else run.get("status", "pending"),
                        "error": None if run.get("status") == "running" else run.get("error"),
                    }
                    for run in project.get("runs", [])
                ]
                payload = json.dumps(project, ensure_ascii=False, default=str)
                self._repo.update_status_and_payload(
                    connection, row["username"], str(project["id"]), "review", payload
                )
                recovered += 1
        return recovered

    def snapshot(self, username: str, project_id: str) -> dict | None:
        project = self.get(username, project_id)
        return deepcopy(project) if project else None

    def delete(self, username: str, project_id: str) -> bool:
        with self._lock, open_connection(self._database_path) as connection:
            return self._repo.delete(connection, username, project_id)


analysis_project_service = AnalysisProjectService()
