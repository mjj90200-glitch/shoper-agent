"""统一异常处理与请求追踪测试。

验证 REST 错误信封（code/message/request_id/details + 兼容 detail 字段）、
X-Request-ID 响应头、未处理异常不泄露内部信息，以及 SSE 稳定错误事件结构。
"""

import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.errors import (
    BadGatewayError,
    build_sse_error_event,
    register_exception_handlers,
)
from app.core.middleware import register_request_id_middleware


def build_test_app() -> FastAPI:
    """构造带统一异常处理器与请求追踪的最小应用，挂载触发各类异常的临时路由。"""

    app = FastAPI()
    register_exception_handlers(app)
    register_request_id_middleware(app)

    class Item(BaseModel):
        name: str

    @app.get("/raise-http-404")
    async def raise_http_404():
        raise HTTPException(status_code=404, detail="未找到分析项目。")

    @app.get("/raise-api-error")
    async def raise_api_error():
        raise BadGatewayError("上游服务不可用。")

    @app.get("/raise-unhandled")
    async def raise_unhandled():
        raise RuntimeError("secret-db-host-10.0.0.9")

    @app.post("/items")
    async def create_item(item: Item):
        return {"ok": True}

    return app


class RestErrorEnvelopeTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(build_test_app(), raise_server_exceptions=False)

    def test_http_exception_returns_envelope_with_compat_detail(self):
        response = self.client.get("/raise-http-404")
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(body["code"], "not_found")
        self.assertEqual(body["message"], "未找到分析项目。")
        self.assertEqual(body["detail"], "未找到分析项目。")
        self.assertTrue(body["request_id"])

    def test_api_error_uses_its_status_and_code(self):
        response = self.client.get("/raise-api-error")
        self.assertEqual(response.status_code, 502)
        body = response.json()
        self.assertEqual(body["code"], "bad_gateway")
        self.assertEqual(body["message"], "上游服务不可用。")
        self.assertTrue(body["request_id"])

    def test_unhandled_exception_is_generic_without_leak(self):
        response = self.client.get("/raise-unhandled")
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertEqual(body["code"], "internal_error")
        self.assertNotIn("secret-db-host-10.0.0.9", response.text)

    def test_validation_error_reports_fields_only(self):
        response = self.client.post("/items", json={"name": 123, "extra": "x"})
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["code"], "validation_error")
        self.assertIn("name", response.text)

    def test_request_id_header_present(self):
        response = self.client.get("/raise-http-404")
        self.assertTrue(response.headers.get("x-request-id"))


class SseErrorEventTests(unittest.TestCase):
    def test_api_error_keeps_safe_message(self):
        event = build_sse_error_event(BadGatewayError("上游服务不可用。"))
        self.assertEqual(
            event,
            {
                "type": "error",
                "code": "bad_gateway",
                "message": "上游服务不可用。",
            },
        )

    def test_unknown_exception_is_generic_without_leak(self):
        event = build_sse_error_event(RuntimeError("mysql+asyncmy://user:pass@host/db"))
        self.assertEqual(event["code"], "query_failed")
        self.assertEqual(event["message"], "查询处理失败，请稍后重试。")
        self.assertNotIn("mysql", event["message"])


if __name__ == "__main__":
    unittest.main()
