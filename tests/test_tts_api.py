"""TTS 接口鉴权和音频响应测试。"""

import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("LLM_API_KEY", "test-key")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routers.tts_router import tts_router
from app.auth.service import UserIdentity


class TTSAPITests(unittest.TestCase):
    def test_requires_login(self):
        app = FastAPI()
        app.include_router(tts_router)
        with TestClient(app) as client:
            self.assertEqual(
                client.post("/api/tts/synthesize", json={"text": "华东销售额最高"}).status_code,
                401,
            )

    def test_returns_mp3_for_authenticated_user(self):
        app = FastAPI()
        app.include_router(tts_router)
        app.dependency_overrides[get_current_user] = lambda: UserIdentity(
            "alice", "Alice", "analyst", (), ()
        )
        with patch(
            "app.api.routers.tts_router.tts_service.synthesize",
            new=AsyncMock(return_value=b"ID3audio"),
        ) as synthesize:
            with TestClient(app) as client:
                response = client.post(
                    "/api/tts/synthesize", json={"text": "华东销售额最高"}
                )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.content, b"ID3audio")
        synthesize.assert_awaited_once_with("华东销售额最高")


if __name__ == "__main__":
    unittest.main()
