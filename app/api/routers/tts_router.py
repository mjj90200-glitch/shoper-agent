"""受登录保护的文本转语音接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.dependencies import get_current_user
from app.api.schemas.tts_schema import SpeechSynthesisRequest
from app.auth.service import UserIdentity
from app.services.tts_service import TTSError, tts_service

tts_router = APIRouter(prefix="/api/tts", tags=["text-to-speech"])


@tts_router.post("/synthesize")
async def synthesize_speech(
    payload: SpeechSynthesisRequest,
    _: Annotated[UserIdentity, Depends(get_current_user)],
):
    try:
        audio, cleaned = await tts_service.synthesize(payload.text)
    except TTSError as error:
        code = (
            status.HTTP_503_SERVICE_UNAVAILABLE
            if "尚未配置" in str(error)
            else status.HTTP_502_BAD_GATEWAY
        )
        raise HTTPException(status_code=code, detail=str(error)) from error
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "private, max-age=300",
            "X-Speech-Text-Length": str(len(cleaned)),
        },
    )
