"""本地演示认证接口。"""

from fastapi import APIRouter, HTTPException, status

from app.api.schemas.auth_schema import LoginResponseSchema, LoginSchema, UserSchema
from app.auth.service import UserIdentity, local_auth_service

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
async def login(payload: LoginSchema):
    result = local_auth_service.authenticate(payload.username, payload.password)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误。",
        )
    token, user = result
    return LoginResponseSchema(access_token=token, user=user_schema(user))
