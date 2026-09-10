"""火山引擎 TTS 接入、播报文本清洗与音频响应解析。"""

import base64
import hashlib
import json
import re
from collections import OrderedDict
from uuid import uuid4

import httpx

from app.conf.app_config import app_config

MAX_SEGMENT_BYTES = 900
MAX_AUDIO_BYTES = 10_000_000


class TTSError(Exception):
    """TTS 配置或上游服务错误。"""


def clean_speech_text(text: str) -> str:
    """移除不适合朗读的结构，同时保留业务结论和数据口径。"""

    cleaned = re.sub(r"```[\s\S]*?```", " ", text)
    cleaned = re.sub(r"!\[([^]]*)]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", cleaned)
    cleaned = re.sub(r"https?://\S+", "链接", cleaned)
    cleaned = re.sub(r"(?m)^\s*\|?(?:\s*:?-+:?\s*\|)+\s*$", " ", cleaned)
    cleaned = re.sub(r"(?m)^\s*#{1,6}\s*", "", cleaned)
    cleaned = re.sub(r"(?m)^\s*[-*+]\s+", "", cleaned)
    cleaned = re.sub(r"(?m)^\s*\d+[.)、]\s+", "", cleaned)
    cleaned = cleaned.replace("`", "").replace("|", "，")
    cleaned = re.sub(r"¥\s*([\d,]+(?:\.\d+)?)", r"\1元", cleaned)
    cleaned = re.sub(r"([\d,]+(?:\.\d+)?)\s*%", r"百分之\1", cleaned)
    cleaned = re.sub(
        r"\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b",
        r"\1年\2月\3日",
        cleaned,
    )
    cleaned = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", cleaned)
    cleaned = re.sub(r"\bGMV\b", "成交总额", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bSQL\b", "查询语句", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[*_~>]", "", cleaned)
    cleaned = re.sub(r"[\U0001F300-\U0001FAFF\u2600-\u27BF]", "", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(
        r"(?<=[\u4e00-\u9fff\d]) (?=[\u4e00-\u9fff\d])", "", cleaned
    )
    cleaned = re.sub(r"\n{2,}", "\n", cleaned)
    return cleaned.strip(" \n，,；;")


def split_speech_text(text: str, max_bytes: int = MAX_SEGMENT_BYTES) -> list[str]:
    """按自然停顿拆分文本，并保证每段 UTF-8 字节数不超过上游限制。"""

    if max_bytes < 12:
        raise ValueError("语音分段上限过小。")
    parts = re.split(r"(?<=[。！？；!?;\n])", text)
    segments: list[str] = []
    current = ""
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if len((current + part).encode("utf-8")) <= max_bytes:
            current += part
            continue
        if current:
            segments.append(current)
            current = ""
        while len(part.encode("utf-8")) > max_bytes:
            size = 0
            split_at = 0
            for index, character in enumerate(part):
                next_size = size + len(character.encode("utf-8"))
                if next_size > max_bytes:
                    break
                size = next_size
                split_at = index + 1
            segments.append(part[:split_at])
            part = part[split_at:]
        current = part
    if current:
        segments.append(current)
    return segments


def parse_volcengine_audio(content: bytes) -> bytes:
    """解析 V3 NDJSON 响应，合并其中的 Base64 音频分片。"""

    chunks: list[bytes] = []
    finished = False
    for raw_line in content.splitlines():
        if not raw_line.strip():
            continue
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError as error:
            raise TTSError("火山引擎返回了无法解析的语音数据。") from error
        code = payload.get("code")
        if code == 20000000:
            finished = True
            continue
        if code not in {0, None}:
            raise TTSError(payload.get("message") or f"火山引擎语音合成失败：{code}")
        encoded = payload.get("data")
        if encoded:
            try:
                chunks.append(base64.b64decode(encoded, validate=True))
            except (ValueError, TypeError) as error:
                raise TTSError("火山引擎返回了损坏的音频分片。") from error
    audio = b"".join(chunks)
    if not finished or not audio:
        raise TTSError("火山引擎没有返回完整音频。")
    return audio


def strip_leading_id3(audio: bytes) -> bytes:
    """移除后续 MP3 分段的 ID3 头，避免拼接音频中途出现元数据。"""

    if len(audio) < 10 or not audio.startswith(b"ID3"):
        return audio
    size_bytes = audio[6:10]
    if any(value & 0x80 for value in size_bytes):
        return audio
    tag_size = (
        (size_bytes[0] << 21)
        | (size_bytes[1] << 14)
        | (size_bytes[2] << 7)
        | size_bytes[3]
    )
    total_size = 10 + tag_size + (10 if audio[5] & 0x10 else 0)
    return audio[total_size:] if total_size < len(audio) else audio


class VolcengineTTSService:
    def __init__(
        self,
        api_key: str,
        voice_type: str,
        resource_id: str = "seed-tts-2.0",
        endpoint: str = "https://openspeech.bytedance.com/api/v3/tts/unidirectional",
        timeout_seconds: int = 30,
    ):
        self.api_key = api_key
        self.voice_type = voice_type
        self.resource_id = resource_id
        self.endpoint = endpoint
        self.timeout_seconds = timeout_seconds
        self._cache: OrderedDict[str, bytes] = OrderedDict()

    async def synthesize(self, text: str) -> tuple[bytes, str]:
        cleaned = clean_speech_text(text)
        if not cleaned:
            raise TTSError("没有可播报的有效文字。")
        if not self.api_key or not self.voice_type:
            raise TTSError("TTS 尚未配置，请检查 API Key 和音色。")
        cache_key = hashlib.sha256(
            f"{self.voice_type}\0{cleaned}".encode()
        ).hexdigest()
        cached = self._cache.get(cache_key)
        if cached is not None:
            self._cache.move_to_end(cache_key)
            return cached, cleaned

        audio_parts = []
        for segment in split_speech_text(cleaned):
            audio_parts.append(await self._synthesize_segment(segment))
        audio = audio_parts[0] + b"".join(
            strip_leading_id3(part) for part in audio_parts[1:]
        )
        if len(audio) > MAX_AUDIO_BYTES:
            raise TTSError("合成音频超过 10MB，请缩短播报内容。")
        self._cache[cache_key] = audio
        self._cache.move_to_end(cache_key)
        while len(self._cache) > 64:
            self._cache.popitem(last=False)
        return audio, cleaned

    async def _synthesize_segment(self, text: str) -> bytes:
        headers = {
            "X-Api-Key": self.api_key,
            "X-Api-Resource-Id": self.resource_id,
            "X-Api-Request-Id": str(uuid4()),
            "Content-Type": "application/json",
        }
        payload = {
            "user": {"uid": "shopkeeper-agent"},
            "req_params": {
                "text": text,
                "speaker": self.voice_type,
                "audio_params": {"format": "mp3", "sample_rate": 24000},
            },
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
                response = await client.post(self.endpoint, headers=headers, json=payload)
                response.raise_for_status()
        except httpx.TimeoutException as error:
            raise TTSError("语音服务响应超时，请稍后重试。") from error
        except httpx.HTTPStatusError as error:
            raise TTSError(f"语音服务请求失败：HTTP {error.response.status_code}") from error
        except httpx.RequestError as error:
            raise TTSError("暂时无法连接语音服务。") from error
        return parse_volcengine_audio(response.content)


tts_service = VolcengineTTSService(
    api_key=app_config.tts.api_key,
    voice_type=app_config.tts.voice_type,
    resource_id=app_config.tts.resource_id,
    endpoint=app_config.tts.endpoint,
    timeout_seconds=app_config.tts.timeout_seconds,
)
