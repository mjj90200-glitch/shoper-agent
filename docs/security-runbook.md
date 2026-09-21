# 安全运维手册：密钥轮换与泄露应急

> 适用范围：本地/受控内网部署。生产部署前需按 README「生产部署注意事项」替换演示账号与签名密钥。

## 1. 密钥清单与位置

| 密钥/凭据 | 位置 | 用途 |
| --- | --- | --- |
| `LLM_API_KEY` | 根目录 `.env` | 大模型 API |
| `VOLCENGINE_TTS_API_KEY` | 根目录 `.env` | 火山引擎语音外发 |
| `MYSQL_ROOT_PASSWORD` / `MYSQL_PASSWORD` | 根目录 `.env` + `docker/.env` | MySQL root / 元数据账号 |
| `DW_PASSWORD` | 根目录 `.env` | 数仓只读账号 `dw_reader` |
| `token_signing_secret` | `conf/auth_config.yaml` | 登录令牌签名 |

## 2. 密钥轮换步骤

1. **LLM / TTS API Key**：在供应商控制台生成新 Key → 更新 `.env` → 重启后端 → 观察一轮问数与朗读。
2. **MySQL 应用账号**：`ALTER USER 'shopkeeper'@'%' IDENTIFIED BY '<新密码>';` → 更新 `.env` 与 `docker/.env` → 重启后端。
3. **数仓只读账号**：`ALTER USER 'dw_reader'@'%' IDENTIFIED BY '<新密码>';` → 更新 `.env` 的 `DW_PASSWORD` → 重启后端。
4. **令牌签名密钥**：编辑 `auth_config.yaml` 的 `token_signing_secret` → 重启后端。所有已发令牌立即失效（预期行为，用户需重新登录）。

## 3. 泄露应急

1. **确认范围**：泄露了哪个密钥、是否已被利用（查 `query_audit_log` 异常查询、供应商控制台用量）。
2. **立即吊销**：按第 2 节步骤轮换对应密钥；API Key 直接在供应商侧吊销。
3. **止损**：必要时 `docker compose -f docker/docker-compose.yaml stop` 停止对外服务。
4. **消除影响**：若数据库凭据泄露，轮换后用 root 审计 `dw`/`meta` 库的异常账号与数据变更。
5. **复盘**：把泄露路径写回本手册的检查清单；确认 `.env` 等未纳入 Git（`git log --all --full -- .env`）。

## 4. 已内置的防线速查

- SQL：AST 校验 → 关键词扫描 → 数据权限三层（P2-A/C），只读账号兜底（P2-B）。
- 限流：登录 10/分钟、问数 20/分钟、分析 10/分钟、TTS 20/分钟 + 每日 2 万字符外发配额（P2-D）。
- TTS 外发：仅后端持有 Key；未配置时功能禁用；审计库不保存业务结果明细。
