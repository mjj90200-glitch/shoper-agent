"""零外部依赖的本地演示认证服务。"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import yaml


@dataclass(frozen=True)
class UserIdentity:
    username: str
    display_name: str
    role: str
    allowed_regions: tuple[str, ...]
    masked_fields: tuple[str, ...]

    def prompt_context(self) -> str:
        if self.role == "admin":
            return "当前用户是管理员，可访问所有地区和字段。"
        parts = [f"当前用户角色：{self.role}。"]
        if self.allowed_regions:
            parts.append(f"仅允许查询地区：{'、'.join(self.allowed_regions)}。")
        if self.masked_fields:
            parts.append(f"禁止查询敏感字段：{'、'.join(self.masked_fields)}。")
        return "".join(parts)


@dataclass(frozen=True)
class _ConfiguredUser:
    identity: UserIdentity
    password_salt: str
    password_hash: str


@dataclass(frozen=True)
class _Session:
    identity: UserIdentity
    expires_at: datetime


class LocalAuthService:
    """内存令牌 + 配置文件账号，仅用于本地演示。"""

    def __init__(self, config_path: Path):
        config = yaml.safe_load(config_path.read_text())
        self._ttl = timedelta(minutes=config["session_ttl_minutes"])
        self._users = {
            item["username"]: _ConfiguredUser(
                identity=UserIdentity(
                    username=item["username"],
                    display_name=item["display_name"],
                    role=item["role"],
                    allowed_regions=tuple(item["allowed_regions"]),
                    masked_fields=tuple(item["masked_fields"]),
                ),
                password_salt=item["password_salt"],
                password_hash=item["password_hash"],
            )
            for item in config["users"]
        }
        self._sessions: dict[str, _Session] = {}

    @staticmethod
    def _password_hash(password: str, salt: str) -> str:
        return hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), 120_000
        ).hex()

    def authenticate(self, username: str, password: str) -> tuple[str, UserIdentity] | None:
        configured_user = self._users.get(username)
        if configured_user is None:
            return None
        actual_hash = self._password_hash(password, configured_user.password_salt)
        if not hmac.compare_digest(actual_hash, configured_user.password_hash):
            return None
        token = secrets.token_urlsafe(32)
        self._sessions[token] = _Session(
            identity=configured_user.identity,
            expires_at=datetime.now(UTC) + self._ttl,
        )
        return token, configured_user.identity

    def get_identity(self, token: str) -> UserIdentity | None:
        session = self._sessions.get(token)
        if session is None or session.expires_at <= datetime.now(UTC):
            self._sessions.pop(token, None)
            return None
        return session.identity

    def revoke(self, token: str) -> None:
        self._sessions.pop(token, None)


project_root = Path(__file__).parents[2]
local_auth_service = LocalAuthService(project_root / "conf" / "auth_config.yaml")
