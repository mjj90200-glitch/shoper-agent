"""零外部依赖的本地演示认证服务。"""

import base64
import hashlib
import hmac
import json
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


class LocalAuthService:
    """使用稳定签名令牌的本地演示认证服务，可跨后端重启验证。"""

    def __init__(self, config_path: Path):
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        self._ttl = timedelta(minutes=config["session_ttl_minutes"])
        self._signing_secret = config["token_signing_secret"].encode("utf-8")
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
        self._revoked_tokens: set[str] = set()

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
        now = datetime.now(UTC)
        payload = {
            "sub": configured_user.identity.username,
            "iat": int(now.timestamp()),
            "exp": int((now + self._ttl).timestamp()),
            "jti": secrets.token_urlsafe(12),
        }
        body = self._encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
        signature = self._sign(body)
        token = f"{body}.{signature}"
        return token, configured_user.identity

    def get_identity(self, token: str) -> UserIdentity | None:
        if token in self._revoked_tokens:
            return None
        try:
            body, signature = token.split(".", 1)
            if not hmac.compare_digest(signature, self._sign(body)):
                return None
            payload = json.loads(self._decode(body))
            if int(payload["exp"]) <= int(datetime.now(UTC).timestamp()):
                return None
            configured_user = self._users.get(str(payload["sub"]))
            return configured_user.identity if configured_user else None
        except (ValueError, KeyError, TypeError, json.JSONDecodeError):
            return None

    def revoke(self, token: str) -> None:
        self._revoked_tokens.add(token)

    @staticmethod
    def _encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")

    @staticmethod
    def _decode(value: str) -> bytes:
        padding = "=" * (-len(value) % 4)
        return base64.urlsafe_b64decode(value + padding)

    def _sign(self, body: str) -> str:
        digest = hmac.new(self._signing_secret, body.encode("ascii"), hashlib.sha256).digest()
        return self._encode(digest)


project_root = Path(__file__).parents[2]
local_auth_service = LocalAuthService(project_root / "conf" / "auth_config.yaml")
