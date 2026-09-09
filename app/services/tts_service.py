"""火山引擎 V3 语音合成服务。"""

from __future__ import annotations

import base64
import binascii
import hashlib
import html
import json
import re
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable

import httpx

from app.conf.app_config import TTSConfig, app_config


class TTSConfigurationError(RuntimeError):
    """语音服务未配置。"""


class TTSUpstreamError(RuntimeError):
    """火山引擎返回不可用响应。"""


def normalize_speech_text(text: str, max_chars: int = 600) -> str:
    """移除不适合播报的技术内容，并规范化常见经营数字。"""

    value = html.unescape(text).replace("\r\n", "\n")
    value = re.sub(r"```[\s\S]*?```", " ", value)
    value = re.sub(r"`[^`]+`", " ", value)
    value = re.sub(r"!\[[^]]*]\([^)]*\)", " ", value)
    value = re.sub(r"\[([^]]+)]\([^)]*\)", r"\1", value)
    value = re.sub(r"https?://\S+|www\.\S+", " ", value)
    value = re.sub(r"(?m)^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$", " ", value)
    value = value.replace("|", "，")
    value = re.sub(r"[>#*_~]", "", value)
    value = re.sub(r"[¥￥]\s*([0-9][0-9,]*(?:\.\d+)?)", lambda m: f"{m.group(1).replace(',', '')}元", value)
    value = re.sub(r"([0-9]+(?:\.\d+)?)\s*%", r"百分之\1", value)
    value = re.sub(
        r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b",
        lambda m: f"{m.group(1)}年{int(m.group(2))}月{int(m.group(3))}日",
        value,
    )
    value = re.sub(
        r"\b(20\d{2})[-/](\d{1,2})\b",
        lambda m: f"{m.group(1)}年{int(m.group(2))}月",
        value,
    )
    value = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", value)
    value = re.sub(r"\s+", " ", value).strip(" ，；、")
    if len(value) > max_chars:
        boundary = max(value.rfind(mark, 0, max_chars) for mark in "。！？；")
        value = value[: boundary + 1 if boundary >= max_chars // 2 else max_chars].rstrip()
    if value and value[-1] not in "。！？":
        value += "。"
    return value


def parse_audio_line(line: str) -> bytes:
    """解析火山 V3 SSE 或 NDJSON 响应中的单个音频片段。"""

    payload = line.strip()
    if not payload or payload.startswith(":"):
        return b""
    if not payload.startswith("data:"):
        return b""
    payload = payload[5:].strip()
    if not payload or payload == "[DONE]":
        return b""
    try:
        event = json.loads(payload)
    except json.JSONDecodeError as error:
        raise TTSUpstreamError("语音服务返回了无法解析的数据。") from error
    code = event.get("code", 0)
    if code not in (0, 20000000):
        message = str(event.get("message") or "语音合成失败")
        raise TTSUpstreamError(f"语音服务返回错误：{message}")
    encoded = event.get("data")
    if not encoded:
        return b""
    try:
        return base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise TTSUpstreamError("语音服务返回了损坏的音频片段。") from error


class TTSService:
    """合成并短期缓存问数结论音频。"""

    def __init__(
        self,
        config: TTSConfig,
        cache_ttl_seconds: int = 300,
        client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
    ):
        self._config = config
        self._cache_ttl_seconds = cache_ttl_seconds
        self._client_factory = client_factory
        self._cache: OrderedDict[str, tuple[float, bytes]] = OrderedDict()

    def _cache_key(self, text: str) -> str:
        raw = f"{self._config.voice_type}\0{text}".encode()
        return hashlib.sha256(raw).hexdigest()

    def _get_cached(self, key: str) -> bytes | None:
        cached = self._cache.get(key)
        if cached is None:
            return None
        created_at, audio = cached
        if time.monotonic() - created_at > self._cache_ttl_seconds:
            self._cache.pop(key, None)
            return None
        self._cache.move_to_end(key)
        return audio

    def _remember(self, key: str, audio: bytes) -> None:
        self._cache[key] = (time.monotonic(), audio)
        self._cache.move_to_end(key)
        while len(self._cache) > 32:
            self._cache.popitem(last=False)

    async def synthesize(self, text: str) -> bytes:
        speech_text = normalize_speech_text(text, self._config.max_chars)
        if len(speech_text) < 2:
            raise ValueError("没有可朗读的业务结论。")
        api_key = (self._config.api_key or "").strip()
        if not api_key:
            raise TTSConfigurationError("语音服务尚未配置 API Key。")

        key = self._cache_key(speech_text)
        cached = self._get_cached(key)
        if cached is not None:
            return cached

        headers = {
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
            "X-Api-Resource-Id": self._config.resource_id,
            "X-Api-Request-Id": str(uuid.uuid4()),
        }
        body = {
            "user": {"uid": "shopkeeper-agent"},
            "req_params": {
                "text": speech_text,
                "speaker": self._config.voice_type,
                "sample_rate": 24000,
                "audio_params": {
                    "format": "mp3",
                    "bit_rate": 64000,
                    "speech_rate": 0,
                    "loudness_rate": 0,
                },
                "additions": json.dumps(
                    {"disable_markdown_filter": False, "enable_latex_tn": False}
                ),
            },
        }

        chunks: list[bytes] = []
        total_size = 0
        try:
            timeout = httpx.Timeout(self._config.timeout_seconds)
            async with self._client_factory(timeout=timeout) as client:
                async with client.stream(
                    "POST", self._config.base_url, headers=headers, json=body
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        chunk = parse_audio_line(line)
                        if not chunk:
                            continue
                        total_size += len(chunk)
                        if total_size > 10 * 1024 * 1024:
                            raise TTSUpstreamError("语音结果超过允许大小。")
                        chunks.append(chunk)
        except TTSUpstreamError:
            raise
        except httpx.TimeoutException as error:
            raise TTSUpstreamError("语音服务响应超时，请稍后重试。") from error
        except httpx.HTTPStatusError as error:
            raise TTSUpstreamError(
                f"语音服务请求失败（HTTP {error.response.status_code}）。"
            ) from error
        except httpx.HTTPError as error:
            raise TTSUpstreamError("暂时无法连接语音服务。") from error

        if not chunks:
            raise TTSUpstreamError("语音服务没有返回音频。")
        audio = b"".join(chunks)
        self._remember(key, audio)
        return audio


tts_service = TTSService(app_config.tts)
