"""本地演示认证接口。"""

import time

from fastapi import APIRouter, HTTPException, Request, status

from app.api.schemas.auth_schema import LoginResponseSchema, LoginSchema, UserSchema
from app.auth.service import UserIdentity, local_auth_service
from app.core.rate_limit import login_limiter

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])


def user_schema(user: UserIdentity) -> UserSchema:
    return UserSchema(
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        allowed_regions=list(user.allowed_regions),
        masked_fields=list(user.masked_fields),
    )


@auth_router.post("/login", response_model=LoginResponseSchema)
async def login(payload: LoginSchema, request: Request):
    client_host = request.client.host if request.client else "unknown"
    if not login_limiter.allow(f"{payload.username}:{client_host}", time.monotonic()):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="登录尝试过于频繁，请稍后再试。",
        )
    result = local_auth_service.authenticate(payload.username, payload.password)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误。",
        )
    token, user = result
    return LoginResponseSchema(access_token=token, user=user_schema(user))
