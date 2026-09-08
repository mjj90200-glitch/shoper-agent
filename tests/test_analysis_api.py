"""数据分析项目 API 的离线权限与参数测试。"""

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

os.environ.setdefault("LLM_API_KEY", "test-key")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routers.analysis_router import analysis_router
from app.auth.service import UserIdentity
from app.services.analysis_project_service import analysis_project_service


def project_payload(project_id: str) -> dict:
    return {
        "id": project_id,
        "title": "地区销售分析",
        "goal": "分析 2025 年各地区销售表现",
        "status": "draft",
        "plan": None,
        "runs": [],
        "report": None,
        "createdAt": 1,
        "updatedAt": 1,
    }


class AnalysisProjectAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        analysis_project_service.configure_database(
            Path(self.directory.name) / "state.sqlite"
        )
        self.app = FastAPI()
        self.app.include_router(analysis_router)
        self.user = UserIdentity("alice", "Alice", "analyst", (), ())
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.directory.cleanup()

    def test_project_crud_is_isolated_by_current_user(self):
        project_id = "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45"
        response = self.client.put(
            f"/api/analysis/projects/{project_id}",
            json=project_payload(project_id),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.client.get("/api/analysis/projects").json()), 1)

        self.user = UserIdentity("bob", "Bob", "analyst", (), ())
        self.assertEqual(self.client.get("/api/analysis/projects").json(), [])

        self.user = UserIdentity("alice", "Alice", "analyst", (), ())
        self.assertEqual(
            self.client.delete(f"/api/analysis/projects/{project_id}").status_code,
            204,
        )
        self.assertEqual(self.client.get("/api/analysis/projects").json(), [])

    def test_path_and_payload_project_ids_must_match(self):
        payload_id = "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45"
        path_id = "c4e66dad-4a1d-47c4-9f38-1a196f191fdd"
        response = self.client.put(
            f"/api/analysis/projects/{path_id}",
            json=project_payload(payload_id),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "项目编号不一致。")


if __name__ == "__main__":
    unittest.main()
