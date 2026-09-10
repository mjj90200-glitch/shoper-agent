"""经过登录鉴权的问数结论语音合成接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.dependencies import get_current_user
from app.api.schemas.tts_schema import TTSSynthesizeRequest
from app.auth.service import UserIdentity
from app.services.tts_service import (
    TTSConfigurationError,
    TTSUpstreamError,
    tts_service,
)

tts_router = APIRouter(prefix="/api/tts", tags=["text-to-speech"])


@tts_router.post(
    "/synthesize",
    responses={
        200: {"content": {"audio/mpeg": {}}, "description": "MP3 语音"},
        503: {"description": "语音服务未配置"},
    },
)
async def synthesize_query_conclusion(
    payload: TTSSynthesizeRequest,
    _: Annotated[UserIdentity, Depends(get_current_user)],
) -> Response:
    """将已经生成的简短业务结论转换为 MP3，不处理流程或 SQL。"""

    try:
        audio = await tts_service.synthesize(payload.text)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(error)
        ) from error
    except TTSConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(error)
        ) from error
    except TTSUpstreamError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)
        ) from error

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": 'inline; filename="query-conclusion.mp3"',
        },
    )
