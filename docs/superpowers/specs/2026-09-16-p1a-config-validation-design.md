# P1-A 配置校验与启动诊断 — 设计文档

> 日期：2026-09-16
> 来源：`docs/superpowers/plans/2026-09-10-engineering-optimization.md` P1-A 节
> 状态：已确认（按既定工程计划执行）

## 1. 问题

当前 `app/conf/app_config.py` 在 **模块 import 时** 就完成 `.env` 读取、YAML 加载和
`${oc.env:...}` 插值，生成全局单例 `app_config`。由此产生四个问题：

1. **import 即失败**：yaml 中 `MYSQL_USER` 等变量没有默认值，任何缺失都会让 import 崩溃。
2. **测试环境脆弱**：CI 靠 workflow 硬编码 `LLM_API_KEY: test-only-key` 等环境变量才能通过；
   本机测试隐式依赖开发者 `.env`。
3. **无启动校验**：必填变量缺失、端口越界、URL 格式错误都拖到运行中才暴露。
4. **难以替换**：全局单例在 import 时创建，测试无法注入显式配置。

## 2. 目标（对应计划验收标准）

- 缺失 `LLM_API_KEY`、`MYSQL_USER`、`MYSQL_PASSWORD` 时**应用启动阶段**快速失败。
- 所有配置错误信息只包含**变量名和期望格式**，不出现密钥、密码取值。
- 测试不依赖开发者本机 `.env`，也不依赖 CI 注入的环境变量。
- 现有全部测试保持通过，并新增配置边界测试。
- `pyproject.toml` 依赖不变（不引入 pydantic-settings，沿用 OmegaConf + dataclass）。

## 3. 设计决策

### 3.1 单一入口 `app/conf/settings.py`

- 类型定义（`AppConfig` 及各子 dataclass）**保留在 `app/conf/app_config.py`**，只删除
  模块级加载和全局实例。
- 加载收敛到 `settings.py` 的纯函数：

```python
def load_app_config(
    *,
    config_file: Path | None = None,   # 默认 <root>/conf/app_config.yaml
    yaml_text: str | None = None,      # 测试可直接内联 YAML
    environ: Mapping[str, str] | None = None,  # 测试注入；None 时用真实环境
    load_env_file: bool = True,        # False 时忽略项目 .env
) -> AppConfig
```

- 缓存访问器 `get_app_config()`（首次调用加载并缓存）+ `reset_app_config_cache()`
  供测试隔离。

### 3.2 环境变量解析：显式覆盖表取代 `${oc.env:...}` 魔法

YAML 中的 `${oc.env:MYSQL_USER}` 插值全部替换为静态默认值（密钥为空串、可选项为
null）。环境变量映射集中到 `settings.py` 的一张 `ENV_FIELDS` 表：环境变量名 →
(配置路径列表, 转换器)。决定性、可枚举、可测试；`MYSQL_*` 同时覆盖 `db_meta` 与
`db_dw` 两组路径。空字符串视为未设置；`VOLCENGINE_TTS_API_KEY` 为空时映射为
`None`（保持"未配置语音时功能可用"的产品行为）。

`.env` 仍由加载器读取（`python-dotenv`），但**不覆盖**已存在的真实环境变量。

### 3.3 两阶段校验

- **结构校验**（`load_app_config` 内）：类型、必填路径存在。不要求密钥非空 ——
  保证 import 与单元测试不需要任何密钥。
- **启动校验** `ensure_runtime_ready(config)`：校验必需环境变量非空
  （`LLM_API_KEY`、`MYSQL_USER`、`MYSQL_PASSWORD`）、`APP_ENV ∈ {dev, test, prod}`、
  各端口 ∈ [1, 65535]、`timeout_seconds`/`max_chars`/`embedding_size` > 0、
  `llm.base_url` 与 `tts.base_url` 为 http/https。任何失败抛
  `SettingsValidationError(errors)`，消息只含变量名与期望格式。

`lifespan()` 启动第一步调用 `ensure_runtime_ready(get_app_config())`，缺失配置时
uvicorn 启动即退出并打印缺失项清单 —— 即"快速失败"。

### 3.4 环境区分

新增 `APP_ENV` 环境变量（`dev` / `test` / `prod`，默认 `dev`），作为 `AppConfig.app_env`
字段暴露并在启动校验中检查取值。行为差异（如认证适配器切换）留给 P2-D，本阶段
只做"区分与校验"，YAGNI。

### 3.5 导入者迁移

8 个 `from app.conf.app_config import app_config` 的模块统一改为
`from app.conf.settings import get_app_config`，使用点改为 `get_app_config().<字段>`；
类型导入（`TTSConfig`、`DBConfig` 等）不受影响。`tests/test_tts_service.py` 只用类型，
不需要改动。

### 3.6 CI 调整

删除 `ci.yml` backend job 中硬编码的 `LLM_API_KEY/MYSQL_USER/MYSQL_PASSWORD` 环境变量
—— 它们正是"测试依赖注入环境"的临时补丁；删除后 CI 仍绿即证明验收达标。

## 4. 非目标（本阶段不做）

- `meta_config.py`（静态知识库描述，无环境变量）与 `conf/auth_config.yaml`
  （本地演示凭据）保持现状；auth 签名密钥外移属于 P2-D。
- 不改变客户端管理器的模块级单例构造方式（它们显式接收 config 对象，已可替换）。
- 不引入新的配置库。

## 5. 影响面

| 文件 | 变更 |
| --- | --- |
| `app/conf/settings.py` | 新建：加载、覆盖表、两阶段校验、缓存 |
| `app/conf/app_config.py` | 删除模块级加载，仅留类型；`AppConfig` 增加 `app_env` 字段 |
| `conf/app_config.yaml` | 移除全部 `${oc.env:...}` 插值，改静态默认值 |
| 8 个导入者 | `app_config` → `get_app_config()` |
| `app/api/lifespan.py` | 启动首步 `ensure_runtime_ready` |
| `.github/workflows/ci.yml` | 删除硬编码 env |
| `tests/test_settings.py` | 新建：配置边界测试 |
