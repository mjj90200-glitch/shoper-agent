"""健康检查接口测试。

存活探针只判断进程；就绪探针逐项检查依赖并聚合为 healthy/degraded/unavailable。
测试通过注入假探针函数验证聚合、超时与不泄密行为，不依赖真实外部服务。
"""

import asyncio
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routers import health_router


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(health_router.health_router)
    return TestClient(app)


async def ok_probe():
    return True


async def fail_probe():
    raise RuntimeError("dependency down")


class LiveProbeTests(unittest.TestCase):
    def test_live_returns_200_healthy(self):
        response = make_client().get("/health/live")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "healthy")


class ReadyProbeTests(unittest.TestCase):
    def test_all_dependencies_healthy(self):
        probes = [
            ("mysql_meta", ok_probe),
            ("qdrant", ok_probe),
            ("elasticsearch", ok_probe),
            ("embedding", ok_probe),
        ]
        with patch.object(health_router, "READY_PROBES", probes):
            response = make_client().get("/health/ready")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "healthy")
        self.assertEqual(len(body["checks"]), 4)
        for check in body["checks"]:
            self.assertEqual(check["status"], "healthy")
            self.assertGreaterEqual(check["latency_ms"], 0)

    def test_partial_failure_is_degraded(self):
        probes = [("mysql_meta", ok_probe), ("qdrant", fail_probe)]
        with patch.object(health_router, "READY_PROBES", probes):
            response = make_client().get("/health/ready")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["status"], "degraded")
        by_name = {check["name"]: check for check in body["checks"]}
        self.assertEqual(by_name["qdrant"]["status"], "unavailable")
        self.assertEqual(by_name["qdrant"]["error"], "RuntimeError")

    def test_total_failure_is_unavailable_503(self):
        probes = [("mysql_meta", fail_probe), ("qdrant", fail_probe)]
        with patch.object(health_router, "READY_PROBES", probes):
            response = make_client().get("/health/ready")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["status"], "unavailable")

    def test_timeout_marked_unavailable(self):
        async def slow_probe():
            await asyncio.sleep(30)

        probes = [("mysql_meta", slow_probe)]
        with patch.object(health_router, "READY_PROBES", probes):
            response = make_client().get("/health/ready")
        self.assertEqual(response.status_code, 503)
        check = response.json()["checks"][0]
        self.assertEqual(check["status"], "unavailable")
        self.assertEqual(check["error"], "TimeoutError")

    def test_error_field_never_contains_message_details(self):
        async def leaky_probe():
            raise RuntimeError("mysql+asyncmy://user:pass@10.0.0.5/db")

        probes = [("mysql_meta", leaky_probe)]
        with patch.object(health_router, "READY_PROBES", probes):
            response = make_client().get("/health/ready")
        self.assertNotIn("mysql+asyncmy", response.text)
        self.assertNotIn("10.0.0.5", response.text)


if __name__ == "__main__":
    unittest.main()
