"""TTS 文本处理、火山响应解析和 API 权限测试。"""

import base64
import json
import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("LLM_API_KEY", "test-key")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user
from app.api.routers.tts_router import tts_router
from app.auth.service import UserIdentity
from app.services.tts_service import (
    TTSError,
    VolcengineTTSService,
    clean_speech_text,
    parse_volcengine_audio,
    split_speech_text,
    strip_leading_id3,
)


class SpeechTextTests(unittest.TestCase):
    def test_clean_text_removes_code_and_normalizes_business_values(self):
        text = """## 结论
- GMV 为 ¥12,358.50，同比增长 18.6%。
```sql
SELECT * FROM sales;
```
详情见 [报告](https://example.com/report)。
"""

        cleaned = clean_speech_text(text)

        self.assertIn("成交总额为12358.50元", cleaned)
        self.assertIn("同比增长百分之18.6", cleaned)
        self.assertIn("详情见报告", cleaned)
        self.assertNotIn("SELECT", cleaned)
        self.assertNotIn("https://", cleaned)

    def test_split_text_respects_utf8_byte_limit(self):
        segments = split_speech_text("华东销售表现稳定。" * 20, max_bytes=60)

        self.assertGreater(len(segments), 1)
        self.assertTrue(all(len(segment.encode("utf-8")) <= 60 for segment in segments))
        self.assertEqual("".join(segments), "华东销售表现稳定。" * 20)


class VolcengineResponseTests(unittest.TestCase):
    def test_parse_ndjson_audio_chunks(self):
        response = b"\n".join(
            [
                json.dumps(
                    {"code": 0, "message": "", "data": base64.b64encode(b"ID3audio").decode()}
                ).encode(),
                json.dumps({"code": 20000000, "message": "OK"}).encode(),
            ]
        )

        self.assertEqual(parse_volcengine_audio(response), b"ID3audio")

    def test_parse_rejects_upstream_error(self):
        with self.assertRaisesRegex(TTSError, "quota exceeded"):
            parse_volcengine_audio(
                json.dumps({"code": 45000000, "message": "quota exceeded"}).encode()
            )

    def test_strip_leading_id3_keeps_mp3_frames(self):
        audio = b"ID3\x04\x00\x00\x00\x00\x00\x03abc" + b"\xff\xfbframes"
        self.assertEqual(strip_leading_id3(audio), b"\xff\xfbframes")


class TTSServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_service_segments_and_caches_audio(self):
        service = VolcengineTTSService("key", "voice")
        first = b"ID3\x04\x00\x00\x00\x00\x00\x00\xff\xfbfirst"
        second = b"ID3\x04\x00\x00\x00\x00\x00\x00\xff\xfbsecond"
        service._synthesize_segment = AsyncMock(side_effect=[first, second])
        text = "华" * 400

        audio, cleaned = await service.synthesize(text)
        cached, _ = await service.synthesize(text)

        self.assertEqual(cleaned, text)
        self.assertEqual(audio, first + b"\xff\xfbsecond")
        self.assertEqual(cached, audio)
        self.assertEqual(service._synthesize_segment.await_count, 2)


class TTSAPITests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(tts_router)
        app.dependency_overrides[get_current_user] = lambda: UserIdentity(
            "alice", "Alice", "analyst", (), ()
        )
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()

    def test_authenticated_api_returns_mp3(self):
        with patch(
            "app.api.routers.tts_router.tts_service.synthesize",
            AsyncMock(return_value=(b"ID3audio", "测试播报")),
        ):
            response = self.client.post("/api/tts/synthesize", json={"text": "测试播报"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "audio/mpeg")
        self.assertEqual(response.content, b"ID3audio")

    def test_upstream_error_is_safe_for_client(self):
        with patch(
            "app.api.routers.tts_router.tts_service.synthesize",
            AsyncMock(side_effect=TTSError("语音服务响应超时，请稍后重试。")),
        ):
            response = self.client.post("/api/tts/synthesize", json={"text": "测试播报"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], "语音服务响应超时，请稍后重试。")

    def test_missing_tts_configuration_returns_service_unavailable(self):
        with patch(
            "app.api.routers.tts_router.tts_service.synthesize",
            AsyncMock(side_effect=TTSError("TTS 尚未配置，请检查 API Key 和音色。")),
        ):
            response = self.client.post("/api/tts/synthesize", json={"text": "测试播报"})

        self.assertEqual(response.status_code, 503)

    def test_unauthenticated_request_is_rejected(self):
        app = FastAPI()
        app.include_router(tts_router)
        with TestClient(app) as client:
            response = client.post("/api/tts/synthesize", json={"text": "测试播报"})

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
