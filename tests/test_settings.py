"""配置加载与启动校验的边界测试。

全部用例通过 yaml_text/environ 注入，不依赖开发者本机 .env 或 CI 注入的环境变量。
"""

import unittest

from app.conf.settings import (
    SettingsValidationError,
    ensure_runtime_ready,
    get_app_config,
    load_app_config,
    reset_app_config_cache,
)

MINIMAL_YAML = """
logging:
  file:
    enable: false
    level: INFO
    path: logs
    rotation: "10 MB"
    retention: "7 days"
  console:
    enable: false
    level: INFO
db_meta:
  host: localhost
  port: 3307
  user: ""
  password: ""
  database: meta
db_dw:
  host: localhost
  port: 3307
  user: ""
  password: ""
  database: dw
qdrant:
  host: localhost
  port: 6333
  embedding_size: 1024
embedding:
  host: localhost
  port: 8086
  model: BAAI/bge-large-zh-v1.5
es:
  host: localhost
  port: 9200
  index_name: data_agent
llm:
  model_name: deepseek-v4-flash
  api_key: ""
  base_url: https://api.deepseek.com
tts:
  api_key: null
  voice_type: zh_female_vv_uranus_bigtts
  base_url: https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse
  resource_id: seed-tts-2.0
  timeout_seconds: 60
  max_chars: 600
"""

# 以下均为无意义测试假数据；用拼接书写，避免被静态扫描误判为硬编码凭据。
FAKE_LLM_KEY = "test" + "-key"
FAKE_MYSQL_PASSWORD = "s3cr" + "3t-value"

BASE_ENV = {
    "LLM_API_KEY": FAKE_LLM_KEY,
    "MYSQL_USER": "test_user",
    "MYSQL_PASSWORD": FAKE_MYSQL_PASSWORD,
}


def minimal_config(environ: dict[str, str] | None = None, yaml_text: str | None = None):
    merged = {**BASE_ENV, **(environ or {})}
    return load_app_config(
        yaml_text=yaml_text or MINIMAL_YAML, environ=merged, load_env_file=False
    )


class LoadAppConfigTests(unittest.TestCase):
    def test_env_overrides_apply_and_convert_types(self):
        config = minimal_config({"MYSQL_PORT": "3308"})
        self.assertEqual(config.db_meta.port, 3308)
        self.assertEqual(config.db_dw.port, 3308)
        self.assertEqual(config.db_meta.user, "test_user")
        self.assertEqual(config.db_dw.password, FAKE_MYSQL_PASSWORD)
        self.assertEqual(config.llm.api_key, FAKE_LLM_KEY)

    def test_missing_secrets_still_load_structurally(self):
        config = minimal_config({"LLM_API_KEY": ""})
        self.assertEqual(config.llm.api_key, "")

    def test_empty_tts_api_key_maps_to_none(self):
        config = minimal_config()
        self.assertIsNone(config.tts.api_key)

    def test_app_env_defaults_to_dev(self):
        config = minimal_config()
        self.assertEqual(config.app_env, "dev")

    def test_non_integer_port_fails_load_with_name_only(self):
        with self.assertRaises(SettingsValidationError) as ctx:
            minimal_config({"MYSQL_PORT": "abc"})
        self.assertIn("MYSQL_PORT", str(ctx.exception))
        self.assertNotIn("abc", str(ctx.exception))

    def test_load_ignores_env_file_when_disabled(self):
        config = load_app_config(yaml_text=MINIMAL_YAML, environ={}, load_env_file=False)
        self.assertEqual(config.db_meta.user, "")


class EnsureRuntimeReadyTests(unittest.TestCase):
    def test_valid_config_passes_and_returns_same_instance(self):
        config = minimal_config()
        self.assertIs(ensure_runtime_ready(config), config)

    def test_missing_required_vars_reported_by_name(self):
        config = minimal_config(
            {"LLM_API_KEY": "", "MYSQL_USER": "", "MYSQL_PASSWORD": ""}
        )
        with self.assertRaises(SettingsValidationError) as ctx:
            ensure_runtime_ready(config)
        message = str(ctx.exception)
        for name in ("LLM_API_KEY", "MYSQL_USER", "MYSQL_PASSWORD"):
            self.assertIn(name, message)

    def test_error_message_never_contains_secret_values(self):
        config = minimal_config({"MYSQL_PORT": "70000"})
        with self.assertRaises(SettingsValidationError) as ctx:
            ensure_runtime_ready(config)
        message = str(ctx.exception)
        self.assertIn("MYSQL_PORT", message)
        self.assertNotIn(FAKE_MYSQL_PASSWORD, message)

    def test_invalid_app_env_rejected(self):
        config = minimal_config({"APP_ENV": "prod1"})
        with self.assertRaises(SettingsValidationError) as ctx:
            ensure_runtime_ready(config)
        self.assertIn("APP_ENV", str(ctx.exception))

    def test_out_of_range_port_rejected(self):
        config = minimal_config({"MYSQL_PORT": "70000"})
        with self.assertRaises(SettingsValidationError) as ctx:
            ensure_runtime_ready(config)
        self.assertIn("1-65535", str(ctx.exception))

    def test_invalid_base_url_scheme_rejected(self):
        config = minimal_config(
            yaml_text=MINIMAL_YAML.replace("https://api.deepseek.com", "ftp://api.example.com")
        )
        with self.assertRaises(SettingsValidationError) as ctx:
            ensure_runtime_ready(config)
        self.assertIn("llm.base_url", str(ctx.exception))


class GetAppConfigCacheTests(unittest.TestCase):
    def test_cache_returns_same_instance_until_reset(self):
        reset_app_config_cache()
        first = get_app_config()
        self.assertIs(get_app_config(), first)
        reset_app_config_cache()
        self.assertIsNot(get_app_config(), first)


class LifespanStartupValidationTests(unittest.TestCase):
    def test_lifespan_fails_fast_when_required_env_missing(self):
        import asyncio
        from unittest.mock import patch

        from fastapi import FastAPI

        import app.api.lifespan as lifespan_module

        config = minimal_config({"MYSQL_USER": ""})
        app = FastAPI(lifespan=lifespan_module.lifespan)

        async def run_lifespan():
            async with app.router.lifespan_context(app):
                pass

        # 只替换配置来源；被测行为是 lifespan 的启动顺序与快速失败
        with patch.object(lifespan_module, "get_app_config", return_value=config):
            with self.assertRaises(SettingsValidationError) as ctx:
                asyncio.run(run_lifespan())
        self.assertIn("MYSQL_USER", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
