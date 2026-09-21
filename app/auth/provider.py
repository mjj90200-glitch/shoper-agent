"""认证提供方协议：本地演示实现与生产身份服务分离的接缝（P2-D）。

当前后端使用 `LocalAuthProvider`（conf/auth_config.yaml 演示账号）。
接入企业统一身份服务时实现本协议并替换依赖装配即可，路由层不感知差异。
"""

from typing import Protocol

from app.auth.service import UserIdentity


class AuthProvider(Protocol):
    """认证提供方需要支持的最小能力集。"""

    def authenticate(self, username: str, password: str) -> tuple[str, UserIdentity] | None:
        """校验用户名密码；成功返回 (访问令牌, 身份)，失败返回 None。"""
        ...

    def get_identity(self, token: str) -> UserIdentity | None:
        """从访问令牌还原身份；无效或过期返回 None。"""
        ...
