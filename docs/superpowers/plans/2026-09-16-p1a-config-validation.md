# P1-A 配置校验与启动诊断 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 import 时的全局配置加载收敛为可注入、可校验、启动快速失败的单一 Settings 入口。

**Architecture:** 类型保留在 `app/conf/app_config.py`；新 `app/conf/settings.py` 提供 `load_app_config()`（纯函数，可注入 environ/yaml）、显式 `ENV_FIELDS` 环境变量覆盖表（取代 `${oc.env:...}` 插值）、`ensure_runtime_ready()`（启动校验，只报变量名不回显取值）、`get_app_config()`/`reset_app_config_cache()`。`lifespan()` 启动首步校验。

**Tech Stack:** Python 3.14 dataclasses、OmegaConf（仅 YAML 解析）、python-dotenv、unittest。

**Spec:** `docs/superpowers/specs/2026-09-16-p1a-config-validation-design.md`

## Global Constraints

- 缺失 `LLM_API_KEY`、`MYSQL_USER`、`MYSQL_PASSWORD` 时启动快速失败；错误信息只含变量名，绝不包含取值。
- 测试不得依赖本机 `.env` 或 CI 注入的环境变量。
- 现有 61 个后端测试保持通过；`pyproject.toml` 依赖不变。
- 每个任务结束提交一次，提交信息描述独立工程变化。

---

### Task 1: settings 模块核心（加载 + 覆盖表 + 校验 + 缓存）

**Files:**
- Create: `app/conf/settings.py`
- Create: `tests/test_settings.py`
- Modify: `conf/app_config.yaml`（移除 `${oc.env:...}`，改静态默认值）
- Modify: `app/conf/app_config.py`（`AppConfig` 增加 `app_env: str = "dev"`；删除模块级加载，仅留类型）

**Interfaces:**
- Produces: `load_app_config(*, config_file: Path | None = None, yaml_text: str | None = None, environ: Mapping[str, str] | None = None, load_env_file: bool = True) -> AppConfig`；`ensure_runtime_ready(config: AppConfig) -> AppConfig`；`SettingsValidationError(Exception)`（含 `errors: list[str]`）；`get_app_config() -> AppConfig`；`reset_app_config_cache() -> None`；常量 `ALLOWED_APP_ENVS = ("dev", "test", "prod")`。

- [ ] **Step 1: 写失败测试**（`tests/test_settings.py`）：内联最小 yaml_text + environ 覆盖生效（`MYSQL_PORT` 转 int）；缺密钥时结构加载成功且 `llm.api_key == ""`；`ensure_runtime_ready` 缺 `LLM_API_KEY/MYSQL_USER/MYSQL_PASSWORD` 时抛错且消息含变量名、不含注入的假值 `s3cr3t-value`；`APP_ENV=prod1` 被拒；`MYSQL_PORT=70000` 与 `MYSQL_PORT=abc` 被拒且只含变量名；TTS key 空串映射为 `None`；非法 base_url scheme 被拒；`load_env_file=False` 读取真实 .env 也不受影响。
- [ ] **Step 2: 运行确认失败**：`uv run python -m unittest tests.test_settings` → ModuleNotFoundError。
- [ ] **Step 3: 实现 settings.py**：`ENV_FIELDS` 覆盖表 + dotenv 合并（真实环境优先）+ OmegaConf 合并 + `collect_startup_errors`/`ensure_runtime_ready` + 手写缓存。
- [ ] **Step 4: 运行确认通过**；同步更新 `app_config.py`/`app_config.yaml`。
- [ ] **Step 5: Commit** `git commit -m "新增 settings 统一配置入口：纯函数加载、显式环境覆盖表与两阶段校验"`

### Task 2: 迁移全部导入者并删除 import 时全局实例

**Files:**
- Modify: `app/agent/llm.py`、`app/core/log.py`、`app/clients/{mysql,qdrant,es,embedding}_client_manager.py`、`app/repositories/qdrant/{column,metric}_qdrant_repository.py`、`app/services/tts_service.py`

**Interfaces:**
- Consumes: `get_app_config()`（Task 1）。
- 保持：`app_config.py` 仍导出 `TTSConfig`/`DBConfig` 等类型（`tests/test_tts_service.py` 依赖）。

- [ ] **Step 1:** 8 个文件把 `from app.conf.app_config import app_config` 换成 `from app.conf.settings import get_app_config`，使用点改 `get_app_config().<字段>`（模块级单例处收敛为一次局部调用）。
- [ ] **Step 2:** `grep -rn "import app_config" app tests` 确认无残留；`env -u MYSQL_USER -u MYSQL_PASSWORD -u LLM_API_KEY uv run python -c "import app.api.lifespan"`（隐藏 .env 时临时改名验证后恢复）证明 import 不再依赖任何密钥。
- [ ] **Step 3:** 全量测试 `uv run python -m unittest discover -s tests` 通过。
- [ ] **Step 4: Commit** `git commit -m "配置加载改为延迟访问：迁移全部导入者到 get_app_config"`

### Task 3: lifespan 启动快速失败 + CI 环境变量移除

**Files:**
- Modify: `app/api/lifespan.py:29`（启动首步 `ensure_runtime_ready(get_app_config())`）
- Modify: `tests/test_settings.py`（补 lifespan 单测：直接构造 FastAPI app 用 TestClient/ASGI 调 lifespan，缺密钥时启动抛 `SettingsValidationError`）
- Modify: `.github/workflows/ci.yml`（删除 backend job 的 `env:` 硬编码块）

- [ ] **Step 1: 写失败测试**：`async with AsyncExitStack` 或 `TestClient` 触发 lifespan，environ 缺 `MYSQL_USER` 时断言抛错且含 `MYSQL_USER`。
- [ ] **Step 2:** 实现接入；本机模拟缺失启动：`env -u LLM_API_KEY … uvicorn` 观察启动即退且错误只列变量名。
- [ ] **Step 3:** 删除 ci.yml `env:` 块；全量测试通过。
- [ ] **Step 4: Commit** `git commit -m "应用启动前校验必需配置并快速失败；CI 不再注入测试环境变量"`

### Task 4: 文档、日志与推送

- [ ] **Step 1:** README「配置」节与 start.md「常见故障」补 APP_ENV 与启动校验说明；CHANGELOG Unreleased 记录。
- [ ] **Step 2:** `workday/9.16.md`、`worktest/9.16.md` 追加 P1-A 小节（真实测试数字）。
- [ ] **Step 3:** 全量质量门禁 `uv run python -m app.scripts.quality_check`；Mimosa 扫描；提交并推送；观察远程 CI。
