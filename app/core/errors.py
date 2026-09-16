"""
统一异常与错误响应结构

所有 REST 错误都返回 {code, message, request_id, details, detail} 信封：
detail 字段与 message 同值，兼容前端现有的 detail 读取逻辑。
未处理异常对外只返回通用文案，完整堆栈进日志并携带 request_id 便于定位。
"""

from typing import Any

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.context import request_id_ctx_var


class APIError(Exception):
    """业务异常基类；子类通过类属性声明错误码与 HTTP 状态。"""

    code = "internal_error"
    http_status = 500
    default_message = "服务内部错误，请稍后重试。"

    def __init__(self, message: str | None = None, *, details: Any = None):
        self.message = message or self.default_message
        self.details = details
        super().__init__(self.message)


class AuthError(APIError):
    code = "auth_error"
    http_status = 401
    default_message = "请先登录。"


class PermissionDeniedError(APIError):
    code = "permission_denied"
    http_status = 403
    default_message = "没有权限执行该操作。"


class NotFoundError(APIError):
    code = "not_found"
    http_status = 404
    default_message = "资源不存在。"


class ConflictError(APIError):
    code = "conflict"
    http_status = 409
    default_message = "资源状态冲突。"


class ValidationError(APIError):
    code = "validation_error"
    http_status = 422
    default_message = "请求参数不合法。"


class BadGatewayError(APIError):
    code = "bad_gateway"
    http_status = 502
    default_message = "上游服务不可用。"


class ServiceUnavailableError(APIError):
    code = "service_unavailable"
    http_status = 503
    default_message = "服务暂不可用。"


def get_request_id() -> str | None:
    """读取当前请求的 request_id；非请求上下文返回 None。"""

    request_id = request_id_ctx_var.get()
    return str(request_id) if request_id else None


def error_envelope(code: str, message: str, details: Any = None) -> dict:
    """构造统一错误信封；detail 为兼容字段，与 message 同值。"""

    return {
        "code": code,
        "message": message,
        "request_id": get_request_id(),
        "details": details,
        "detail": message,
    }


_HTTP_STATUS_CODES = {
    401: "auth_error",
    403: "permission_denied",
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    502: "bad_gateway",
    503: "service_unavailable",
}


def build_sse_error_event(exc: Exception) -> dict:
    """把流式过程中的异常包装成稳定的 SSE 错误事件。

    已知业务异常保留安全文案；未知异常不回显原始文本，避免泄露
    SQL、连接串等内部信息（完整堆栈由调用方记录到日志）。
    """

    if isinstance(exc, APIError):
        return {"type": "error", "code": exc.code, "message": exc.message}
    return {"type": "error", "code": "query_failed", "message": "查询处理失败，请稍后重试。"}


def register_exception_handlers(app: FastAPI) -> None:
    """把统一异常处理器挂到应用上；main.py 启动时调用一次。"""

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request, exc: StarletteHTTPException):
        code = _HTTP_STATUS_CODES.get(exc.status_code, "http_error")
        response = JSONResponse(
            status_code=exc.status_code,
            content=error_envelope(code, str(exc.detail)),
        )
        if exc.headers:
            response.headers.raw.extend(exc.headers.raw)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request, exc: RequestValidationError):
        # 只保留字段路径与错误类型，不回显用户原始输入
        details = [
            {
                "field": ".".join(str(part) for part in error.get("loc", ())[1:]),
                "type": error.get("type"),
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_envelope("validation_error", "请求参数不合法。", details),
        )

    @app.exception_handler(APIError)
    async def api_error_handler(request, exc: APIError):
        return JSONResponse(
            status_code=exc.http_status,
            content=error_envelope(exc.code, exc.message, exc.details),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request, exc: Exception):
        logger.exception("未处理异常：{}", exc)
        return JSONResponse(
            status_code=500,
            content=error_envelope("internal_error", "服务内部错误，请稍后重试。"),
        )
