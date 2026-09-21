"""
统一配置入口

负责把 conf/app_config.yaml 与环境变量合并为结构化 AppConfig，并在应用启动前完成
必要性与取值范围校验。加载是纯函数：测试可以注入 environ 与 YAML 内容，
不依赖开发者本机的 .env 文件。
"""

import os
from collections.abc import Mapping
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from dotenv import dotenv_values
from omegaconf import OmegaConf

if TYPE_CHECKING:
    from app.conf.app_config import AppConfig

PROJECT_ROOT = Path(__file__).parents[2]
DEFAULT_CONFIG_FILE = PROJECT_ROOT / "conf" / "app_config.yaml"
DEFAULT_ENV_FILE = PROJECT_ROOT / ".env"

ALLOWED_APP_ENVS = ("dev", "test", "prod")

# 环境变量 → (配置路径列表, 转换器)。空字符串一律视为未设置；
# TTS 密钥为可选项，为空时写回 None，保持未配置语音时功能可用的产品行为。
ENV_FIELDS: dict[str, tuple[list[str], object]] = {
    "MYSQL_HOST": (["db_meta.host", "db_dw.host"], str),
    "MYSQL_PORT": (["db_meta.port", "db_dw.port"], int),
    "MYSQL_USER": (["db_meta.user", "db_dw.user"], str),
    "MYSQL_PASSWORD": (["db_meta.password", "db_dw.password"], str),
    # 数仓可配置独立只读账号（P2-B 最小权限）；未设置时回退到 MYSQL_* 凭据
    "DW_USER": (["db_dw.user"], str),
    "DW_PASSWORD": (["db_dw.password"], str),
    "LLM_API_KEY": (["llm.api_key"], str),
    "APP_ENV": (["app_env"], str),
    "VOLCENGINE_TTS_API_KEY": (["tts.api_key"], lambda value: value or None),
    "VOLCENGINE_TTS_VOICE_TYPE": (["tts.voice_type"], str),
    "VOLCENGINE_TTS_BASE_URL": (["tts.base_url"], str),
    "VOLCENGINE_TTS_RESOURCE_ID": (["tts.resource_id"], str),
}


class SettingsValidationError(Exception):
    """配置校验失败。errors 只包含变量名与期望格式，不包含任何取值。"""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("；".join(errors))


def _resolve_environ(environ: Mapping[str, str] | None, load_env_file: bool) -> dict[str, str]:
    """确定生效的环境变量；.env 只补缺，不覆盖真实环境变量。"""

    if environ is not None:
        return dict(environ)
    file_values: Mapping[str, str | None] = {}
    if load_env_file and DEFAULT_ENV_FILE.exists():
        file_values = dotenv_values(DEFAULT_ENV_FILE)
    merged = {key: value for key, value in file_values.items() if value is not None}
    merged.update(os.environ)
    return merged


def load_app_config(
    *,
    config_file: Path | None = None,
    yaml_text: str | None = None,
    environ: Mapping[str, str] | None = None,
    load_env_file: bool = True,
) -> "AppConfig":
    """加载 YAML 并按覆盖表应用环境变量，返回结构化配置。

    本函数只做结构加载与类型转换，不要求密钥非空；运行必需性由
    ensure_runtime_ready 在应用启动阶段校验。
    """

    # 函数级导入避免与 app_config.py（类型定义）循环依赖
    from app.conf.app_config import AppConfig

    if yaml_text is not None:
        context = OmegaConf.create(yaml_text)
    else:
        context = OmegaConf.load(config_file or DEFAULT_CONFIG_FILE)

    schema = OmegaConf.structured(AppConfig)
    merged = OmegaConf.merge(schema, context)

    effective_env = _resolve_environ(environ, load_env_file)
    errors: list[str] = []
    for env_name, (paths, converter) in ENV_FIELDS.items():
        raw_value = effective_env.get(env_name)
        if raw_value is None or raw_value == "":
            continue
        try:
            value = converter(raw_value)
        except (TypeError, ValueError):
            errors.append(f"环境变量 {env_name} 取值格式不正确")
            continue
        for path in paths:
            if "." in path:
                section, field = path.split(".", 1)
                setattr(getattr(merged, section), field, value)
            else:
                setattr(merged, path, value)

    config: AppConfig = OmegaConf.to_object(merged)

    # 数仓未配置专用账号时回退到元数据库凭据，保持既有部署开箱即用
    if not config.db_dw.user:
        config.db_dw.user = config.db_meta.user
    if not config.db_dw.password:
        config.db_dw.password = config.db_meta.password

    if errors:
        raise SettingsValidationError(errors)
    return config


def collect_startup_errors(config: "AppConfig") -> list[str]:
    """汇总启动必需项与取值范围问题；消息只含变量名，不回显取值。"""

    errors: list[str] = []

    if not config.llm.api_key:
        errors.append("缺少必需的环境变量 LLM_API_KEY")
    if not config.db_meta.user:
        errors.append("缺少必需的环境变量 MYSQL_USER")
    if not config.db_meta.password:
        errors.append("缺少必需的环境变量 MYSQL_PASSWORD")

    if config.app_env not in ALLOWED_APP_ENVS:
        errors.append(f"APP_ENV 仅允许 {'/'.join(ALLOWED_APP_ENVS)}")

    for name, port in (
        ("MYSQL_PORT", config.db_meta.port),
        ("MYSQL_PORT", config.db_dw.port),
        ("QDRANT_PORT", config.qdrant.port),
        ("EMBEDDING_PORT", config.embedding.port),
        ("ES_PORT", config.es.port),
    ):
        if not 1 <= port <= 65535:
            errors.append(f"{name} 必须在 1-65535 范围内")

    if config.qdrant.embedding_size <= 0:
        errors.append("qdrant.embedding_size 必须大于 0")
    if config.tts.timeout_seconds <= 0:
        errors.append("tts.timeout_seconds 必须大于 0")
    if config.tts.max_chars <= 0:
        errors.append("tts.max_chars 必须大于 0")

    for path, url in (
        ("llm.base_url", config.llm.base_url),
        ("tts.base_url", config.tts.base_url),
    ):
        if urlsplit(url).scheme not in ("http", "https"):
            errors.append(f"{path} 仅允许 http/https 地址")

    return errors


def ensure_runtime_ready(config: "AppConfig") -> "AppConfig":
    """应用启动前调用；任何缺失或越界都以 SettingsValidationError 快速失败。"""

    errors = collect_startup_errors(config)
    if errors:
        raise SettingsValidationError(errors)
    return config


_app_config: "AppConfig | None" = None


def get_app_config() -> "AppConfig":
    """返回进程级共享配置；首次调用时加载并缓存。"""

    global _app_config
    if _app_config is None:
        _app_config = load_app_config()
    return _app_config


def reset_app_config_cache() -> None:
    """清空缓存；测试用它隔离环境变量变化。"""

    global _app_config
    _app_config = None
