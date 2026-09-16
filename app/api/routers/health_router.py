"""
健康检查接口

/health/live 只判断进程存活；/health/ready 逐项探测 MySQL、Qdrant、
Elasticsearch 和 Embedding 的就绪状态，并聚合为 healthy / degraded / unavailable。
探测不调用大模型、不执行业务 SQL、不返回任何连接凭据，失败信息只暴露异常类型名。
"""

import asyncio
import time

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.clients.embedding_client_manager import embedding_client_manager
from app.clients.es_client_manager import es_client_manager
from app.clients.mysql_client_manager import (
    dw_mysql_client_manager,
    meta_mysql_client_manager,
)
from app.clients.qdrant_client_manager import qdrant_client_manager
from app.conf.settings import get_app_config

health_router = APIRouter(tags=["health"])

PROBE_TIMEOUT_SECONDS = 2.0


async def _probe_mysql_meta():
    factory = meta_mysql_client_manager.session_factory
    if factory is None:
        raise RuntimeError("mysql meta not initialized")
    # 只建立真实连接验证连通性与凭据，不执行任何 SQL
    async with factory() as session:
        await session.connection()


async def _probe_mysql_dw():
    factory = dw_mysql_client_manager.session_factory
    if factory is None:
        raise RuntimeError("mysql dw not initialized")
    async with factory() as session:
        await session.connection()


async def _probe_qdrant():
    client = qdrant_client_manager.client
    if client is None:
        raise RuntimeError("qdrant not initialized")
    await client.info()


async def _probe_elasticsearch():
    client = es_client_manager.client
    if client is None:
        raise RuntimeError("elasticsearch not initialized")
    if not await client.ping():
        raise RuntimeError("elasticsearch ping failed")


async def _probe_embedding():
    config = get_app_config().embedding
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_SECONDS) as client:
        response = await client.get(f"http://{config.host}:{config.port}/health")
        response.raise_for_status()


# 就绪探针清单；测试通过替换此列表注入假探针
READY_PROBES: list[tuple[str, object]] = [
    ("mysql_meta", _probe_mysql_meta),
    ("mysql_dw", _probe_mysql_dw),
    ("qdrant", _probe_qdrant),
    ("elasticsearch", _probe_elasticsearch),
    ("embedding", _probe_embedding),
]


async def _run_probe(name: str, probe) -> dict:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(probe(), timeout=PROBE_TIMEOUT_SECONDS)
        status, error = "healthy", None
    except asyncio.TimeoutError:
        status, error = "unavailable", "TimeoutError"
    except Exception as exc:  # 探测失败只保留异常类型名，避免泄露连接信息
        status, error = "unavailable", type(exc).__name__
    latency_ms = round((time.perf_counter() - started) * 1000, 1)
    check = {"name": name, "status": status, "latency_ms": latency_ms}
    if error:
        check["error"] = error
    return check


async def _collect_checks(probes: list[tuple[str, object]]) -> list[dict]:
    return list(await asyncio.gather(*(_run_probe(name, probe) for name, probe in probes)))


@health_router.get("/health/live")
async def live():
    """进程存活探针：不访问任何外部依赖。"""

    return {"status": "healthy"}


@health_router.get("/health/ready")
async def ready():
    """就绪探针：healthy 与 degraded 返回 200，unavailable 返回 503。"""

    checks = await _collect_checks(READY_PROBES)
    statuses = {check["status"] for check in checks}
    if "healthy" not in statuses:
        overall = "unavailable"
    elif "unavailable" in statuses:
        overall = "degraded"
    else:
        overall = "healthy"
    status_code = 200 if overall != "unavailable" else 503
    return JSONResponse(status_code=status_code, content={"status": overall, "checks": checks})
