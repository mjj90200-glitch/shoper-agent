"""TTS 文本清洗、火山协议解析和缓存测试。"""

import base64
import json
import os
import unittest

import httpx

os.environ.setdefault("LLM_API_KEY", "test-key")

from app.conf.app_config import TTSConfig
from app.services.tts_service import (
    TTSConfigurationError,
    TTSService,
    TTSUpstreamError,
    normalize_speech_text,
    parse_audio_line,
)


def config(api_key: str = "test-tts-key") -> TTSConfig:
    return TTSConfig(
        api_key=api_key,
        voice_type="zh_female_vv_uranus_bigtts",
        base_url="https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse",
        resource_id="seed-tts-2.0",
        timeout_seconds=3,
        max_chars=600,
    )


class TTSTextTests(unittest.TestCase):
    def test_normalizes_only_readable_business_content(self):
        text = "**结论**：[华东](https://example.com) 销售额为 ￥12,345.50，占 35.2%。```sql\nSELECT * FROM sales\n```"
        cleaned = normalize_speech_text(text)
        self.assertNotIn("http", cleaned)
        self.assertNotIn("SELECT", cleaned)
        self.assertEqual(cleaned, "结论：华东 销售额为 12345.50元，占 百分之35.2。")

    def test_normalizes_dates_for_chinese_reading(self):
        self.assertEqual(normalize_speech_text("2025-03-08 达到峰值"), "2025年3月8日 达到峰值。")

    def test_rejects_upstream_business_error(self):
        with self.assertRaises(TTSUpstreamError):
            parse_audio_line(
                'data: {"code":30000001,"message":"invalid speaker"}'
            )

    def test_ignores_sse_control_lines(self):
        self.assertEqual(parse_audio_line("event: message"), b"")
        self.assertEqual(parse_audio_line("id: 123"), b"")


class TTSServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_combines_sse_audio_chunks_and_reuses_cache(self):
        calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            self.assertEqual(request.headers["X-Api-Key"], "test-tts-key")
            self.assertEqual(request.headers["X-Api-Resource-Id"], "seed-tts-2.0")
            body = json.loads(request.content)
            self.assertEqual(body["req_params"]["speaker"], "zh_female_vv_uranus_bigtts")
            chunks = [
                {"code": 0, "data": base64.b64encode(b"ID3").decode()},
                {"code": 20000000, "data": base64.b64encode(b"audio").decode()},
            ]
            content = "".join(f"data: {json.dumps(item)}\n\n" for item in chunks)
            return httpx.Response(200, text=content)

        transport = httpx.MockTransport(handler)
        service = TTSService(
            config(),
            client_factory=lambda **kwargs: httpx.AsyncClient(
                transport=transport, **kwargs
            ),
        )
        self.assertEqual(await service.synthesize("华东销售额最高"), b"ID3audio")
        self.assertEqual(await service.synthesize("华东销售额最高"), b"ID3audio")
        self.assertEqual(calls, 1)

    async def test_missing_api_key_fails_without_network_request(self):
        service = TTSService(config(api_key=""))
        with self.assertRaises(TTSConfigurationError):
            await service.synthesize("华东销售额最高")


if __name__ == "__main__":
    unittest.main()
