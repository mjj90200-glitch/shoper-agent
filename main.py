"""
FastAPI 应用入口

负责创建后端应用实例，注册应用生命周期函数，并把各业务模块中的 router
挂载到同一个 app 上。HTTP 请求会先进入这里创建的 app，再按路由分发到
具体的接口处理函数。
"""

from fastapi import FastAPI

from app.api.lifespan import lifespan
from app.api.routers.analysis_router import analysis_router
from app.api.routers.audit_router import audit_router, session_router
from app.api.routers.auth_router import auth_router
from app.api.routers.health_router import health_router
from app.api.routers.query_router import query_router
from app.api.routers.tts_router import tts_router
from app.core.errors import register_exception_handlers
from app.core.middleware import register_request_id_middleware

# lifespan 交给 FastAPI 管理，用于在服务启动和关闭时统一初始化与释放外部客户端
app = FastAPI(lifespan=lifespan)

# 统一错误信封：所有 REST 错误返回 code/message/request_id/details 结构
register_exception_handlers(app)
# 每个请求注入 request_id 并回传 X-Request-ID 响应头
register_request_id_middleware(app)

# 把查询路由注册进应用；没有挂载时，/docs 和真实 HTTP 请求都访问不到该接口
app.include_router(query_router)
app.include_router(auth_router)
app.include_router(audit_router)
app.include_router(session_router)
app.include_router(analysis_router)
app.include_router(tts_router)
app.include_router(health_router)
