"""
请求追踪中间件

为每个请求生成 request_id，写入日志上下文并回传 X-Request-ID 响应头；
错误信封与日志共用同一标识，便于从前端报错直接定位后端日志。
"""

import uuid

from fastapi import FastAPI, Request

from app.core.context import request_id_ctx_var


def register_request_id_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def add_request_id(request: Request, call_next):
        # 请求被处理之前
        request_id = uuid.uuid4()
        request_id_ctx_var.set(request_id)
        response = await call_next(request)
        # 响应头携带 request_id，错误信封与日志使用同一标识便于定位
        response.headers["X-Request-ID"] = str(request_id)
        # 请求被处理之后
        return response
