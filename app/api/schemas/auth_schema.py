"""本地演示登录接口的数据结构。"""

from pydantic import BaseModel, Field


class LoginSchema(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class UserSchema(BaseModel):
    username: str
    display_name: str
    role: str
    allowed_regions: list[str]
    masked_fields: list[str]


class LoginResponseSchema(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSchema
