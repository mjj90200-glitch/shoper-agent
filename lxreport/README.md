# lxreport 文件夹说明

本文件夹是 2026-09-03 对项目 9.03 测试需求（P8–P10）执行测试后的**自包含交付包**：
一份主报告 + 四类证据 + 复跑脚本。所有结论均可通过本目录内的原始证据复核。

## 目录结构

```text
lxreport/
├─ README.md               ← 本文件：文件夹构成说明
├─ 09-03-report.md         ← 主报告：9.03 逐项结果 + 证据索引 + 结论
├─ offline/                ← A 部分：离线检查原始输出
├─ api/                    ← A3/A4：接口边界证据（401/403/404/422/200）
├─ restart/                ← B 部分：两次重启验证的完整请求响应
├─ frontend/               ← C 部分：UI 截图与页面 DOM 探测结果
└─ tools/                  ← 复跑测试的脚本与依赖
```

## 各部分说明

### 09-03-report.md（主报告）

逐项对照 9.03 的 A/B/C 章节记录结果，每条结论带 ✅/⚠️/❌ 状态和证据路径。
包含测试记录模板、发现的问题、上线结论，是浏览本文件夹的入口。

### offline/（A 部分：自动化测试原始输出）

| 文件 | 内容 |
|---|---|
| `ruff.txt` | `ruff check app tests main.py` 输出（通过） |
| `unittest.txt` | `unittest discover` 输出（32/32 通过） |
| `tsc.txt` | 前端 TypeScript 检查输出（无错误） |
| `vite-build.txt` | 前端 Vite 生产构建输出 |

### api/（A3/A4：接口边界证据）

文件名为"测试点缩写 + 预期状态"，与 9.03 条目对应：

- `a2-1-other-user-feedback-404.json`：其他用户对同一审计提交反馈 → 404
- `a2-2-repeat-feedback.json`：同一审计重复提交反馈 → 200（观察项）
- `a3-1-no-token-401.json`：无 Bearer 调用 /api/sessions → 401
- `a3-2-rename-ok.json` / `a3-3-rename-empty-422.json` / `a3-4-rename-long-422.json`：会话改名边界
- `a3-5-cross-user-rename-404.json` / `a3-6-cross-user-delete-404.json`：越权操作 → 404
- `a3-7-own-session-detail.json`：本人会话详情（含审计型历史）
- `openapi.json`：测试当日后端接口契约快照

每个 json 含 `http_status` 与响应体，可独立复核。

### restart/（B 部分：重启验证证据链）

按场景编号（b1/b2/b3），文件顺序即执行顺序；`*-before-restart` / `*-after-restart`
区分后端重启前后。辅助文件保存运行期变量：

- `b1-*`：B1 持久化追问（华东 Q1 → 重启 → 同会话问"那华北呢？"，改写与 SQL 正确）
- `b2-*`：B2 审计/反馈/会话重启恢复（问数 → 反馈 → 重启 → 数据仍在 → 跨用户隔离）
- `b3-*`：B3 删除边界（删除会话 → 元数据与审计清除；checkpoint 物理删除 = 预期失败）
- `*-login.json`、`*-session.txt`、`*-audit-id.txt`、`*-token*.txt`：执行过程中使用的账号会话与 token

### frontend/（C 部分：UI 证据）

截图为 `c0/c1/c2` 前缀，对应 9.03 的 C1/C2 章节：

- `c0-admin-main.png`：admin 登录后主界面
- `c1-*`：历史面板、会话详情、hover 探测（删除控件不存在）
- `c2-*`：管理员质量指标、analyst 个人视角、窄屏适配
- `probe-login.txt` / `probe-chat.txt`：登录页与聊天页 DOM 结构
- `ui-results.json` / `ui-results2.json` / `hover-labels.json`：自动化断言的结构化结果

### tools/（复跑脚本）

- `b_client.py`：API 测试客户端，子命令：login / query / audits-me / feedback /
  quality-summary / sessions-list / session-get / session-patch / session-delete
- `probe_ui.mjs` / `probe_chat.mjs`：登录页/聊天页结构探测（Edge 无头浏览器）
- `ui_flow.mjs` / `ui_flow2.mjs`：C 部分主流程（问数、历史、审计、截图）
- `hover_probe.mjs`：验证历史面板是否存在删除/重命名控件
- `package.json`、`pnpm-lock.yaml`、`node_modules/`：playwright-core 依赖

## 使用方式

1. **看结论**：打开 `09-03-report.md`。
2. **复核某项**：按报告中的证据路径打开对应 json / txt / png。
3. **复跑测试**：先启动 Docker 服务与后端（uvicorn main:app --port 8000）、前端（pnpm dev），
   再按 tools/ 内脚本执行；证据文件会按同名规则重新生成。

## 生成信息

- 日期：2026-09-03
- 环境：Docker Desktop（WSL2）+ DeepSeek LLM + Edge 无头浏览器
- 依赖：测试工具仅使用本地文件；数据与 Key 不落盘于本目录
