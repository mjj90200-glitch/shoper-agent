"""会话删除接口的幂等性和账号隔离测试。"""

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

os.environ.setdefault("LLM_API_KEY", "test-key")
os.environ.setdefault("MYSQL_USER", "test-user")
os.environ.setdefault("MYSQL_PASSWORD", "test-password")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routers.audit_router import session_router
from app.audit.service import QueryAuditService
from app.auth.service import UserIdentity


class SessionDeleteAPITests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.service = QueryAuditService()
        self.service.configure_database(Path(self.directory.name) / "state.sqlite")
        self.service_patch = patch(
            "app.api.routers.audit_router.query_audit_service", self.service
        )
        self.service_patch.start()

        self.user = UserIdentity("alice", "Alice", "analyst", (), ())
        self.app = FastAPI()
        self.app.include_router(session_router)
        self.app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.service_patch.stop()
        self.directory.cleanup()

    def test_deleting_missing_session_is_idempotent(self):
        response = self.client.delete("/api/sessions/stale-local-session")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")

    def test_existing_session_can_be_deleted_repeatedly(self):
        session_id = "session-to-delete"
        self.service.start("alice", session_id, "查询销售额")

        self.assertEqual(
            self.client.delete(f"/api/sessions/{session_id}").status_code, 204
        )
        self.assertEqual(self.service.list_sessions("alice"), [])
        self.assertEqual(
            self.client.delete(f"/api/sessions/{session_id}").status_code, 204
        )

    def test_deleting_another_users_session_does_not_remove_it(self):
        session_id = "bob-private-session"
        self.service.start("bob", session_id, "查询华南销售额")

        response = self.client.delete(f"/api/sessions/{session_id}")

        self.assertEqual(response.status_code, 204)
        self.assertEqual(len(self.service.list_sessions("bob")), 1)


if __name__ == "__main__":
    unittest.main()
