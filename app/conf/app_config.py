"""
应用主配置的类型定义

这里只声明 conf/app_config.yaml 的结构化类型（dataclass）。加载与校验逻辑统一在
app/conf/settings.py；新代码一律通过 app.conf.settings.get_app_config() 获取配置。
"""

from dataclasses import dataclass


@dataclass
class File:
    """文件日志配置"""

    enable: bool
    level: str
    path: str
    rotation: str
    retention: str


@dataclass
class Console:
    """控制台日志配置"""

    enable: bool
    level: str


@dataclass
class LoggingConfig:
    """日志总配置"""

    file: File
    console: Console


@dataclass
class DBConfig:
    """MySQL 连接配置"""

    host: str
    port: int
    user: str
    password: str
    database: str


@dataclass
class QdrantConfig:
    """Qdrant 连接与向量维度配置"""

    host: str
    port: int
    embedding_size: int


@dataclass
class EmbeddingConfig:
    """Embedding 服务配置"""

    host: str
    port: int
    model: str


@dataclass
class ESConfig:
    """Elasticsearch 配置"""

    host: str
    port: int
    index_name: str


@dataclass
class LLMConfig:
    """大模型调用配置"""

    model_name: str
    api_key: str
    base_url: str


@dataclass
class TTSConfig:
    """火山引擎语音合成配置。密钥只在后端读取。"""

    api_key: str | None
    voice_type: str
    base_url: str
    resource_id: str
    timeout_seconds: float
    max_chars: int


@dataclass
class AppConfig:
    """项目级总配置入口"""

    logging: LoggingConfig
    db_meta: DBConfig
    db_dw: DBConfig
    qdrant: QdrantConfig
    embedding: EmbeddingConfig
    es: ESConfig
    llm: LLMConfig
    tts: TTSConfig
    # 运行环境标识（dev/test/prod），由 APP_ENV 环境变量注入
    app_env: str = "dev"


# 过渡期兼容：旧代码仍以 `from app.conf.app_config import app_config` 获取实例。
# 全部导入者迁移到 get_app_config() 后，此全局实例将被删除。
from app.conf.settings import load_app_config  # noqa: E402

app_config: AppConfig = load_app_config()
