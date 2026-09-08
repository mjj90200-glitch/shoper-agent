# lxreport1.0 文件夹说明

本文件夹是对项目根目录 `测试.md`（2026-09-07 版）全量测试需求执行后的**自包含交付包**：
一份主报告 + 分类证据 + 可复跑脚本。所有结论均可通过本目录内原始证据复核。

## 目录结构

```text
lxreport1.0/
├─ README.md               <- 本文件：文件夹构成说明
├─ 测试报告.md              <- 主报告：逐项结果 + 缺陷清单 + 结论
├─ offline/                <- A 层：自动化基线证据
│   ├─ unittest.txt           单元测试 37/37
│   ├─ tsc.txt                TypeScript 检查
│   ├─ vite-build.txt         前端生产构建
│   └─ eval-query-35-35.json   问数评测集 35/35
├─ api/                    <- B 层：接口证据（认证/会话/审计/分析/越权）
├─ functional/             <- C 层：P0 功能证据（问数/会话/分析/权限/安全）
├─ scenario/               <- D 层：P1 场景证据（计划/异常/401/服务中断/导出）
├─ ui/                     <- UI 证据（桌面/小屏/手机截图 + DOM 探测 + 交互结果）
├─ perf/                   <- 性能记录（并入 测试报告.md）
└─ tools/                  <- 可复跑脚本（API 测试、UI 流程、证据收集）
```

## 各部分说明

### offline/（A 层自动化基线）

| 文件 | 内容 |
| --- | --- |
| unittest.txt | Python 单元测试 37/37 通过 |
| tsc.txt | 前端 TypeScript 检查（exit 0） |
| vite-build.txt | Vite 生产构建成功 |
| eval-query-35-35.json | 问数评测集 35/35 轮通过（100%） |

### api/（B 层接口证据）

- `auth/`：登录成功、错误密码 401、三角色登录
- `sessions/`：会话列表/详情/重命名/删除/跨用户 404/无 token 401
- `audit/`：审计列表、反馈、质量汇总（admin 可见/analyst 403）、跨用户反馈 404
- `analysis/`：项目 CRUD、路径 ID 不一致 400、跨用户删除验证
- `test-summary.json`：API 证据汇总

### functional/（C 层 P0 功能证据）

- `ask/`：华北基准 41099.5、多轮追问、TC-Q-01~10、非数据边界、SQL 防护、服务中断/恢复
- `session/`：会话相关
- `analysis/`：计划生成、5 步执行结果、综合报告、持久化/重启恢复
- `perm/`：区域经理权限范围
- `sec/`：只读 SQL 防护与数据完整性

### scenario/（D 层 P1 场景证据）

- `plan/`：超范围目标后备计划
- `run/`：401 登录失效 7 项接口
- `export/`：单步 CSV、完整数据 CSV（含 BOM）

### ui/（UI 证据）

- `desktop-1440/`：登录、问数结果、隐藏流程、模式切换、分析计划/报告、重命名/删除、CSV
- `laptop-1024/`、`mobile-390/`：小屏/手机截图
- `probe-*.json`：页面 DOM 结构探测
- `ui-*.json`：各交互流程的结构化结果（问数、会话管理、删除、图表/导出、计划编辑/停止、重试/跳过）

### tools/（复跑脚本）

- `api_tests.py`：B 层接口测试（Python，需后端运行）
- `collect_summary.py`：扫描证据生成 test-summary.json
- `*_flow.mjs` / `ui_*.mjs`：Playwright UI 测试（链接 playwright-core，Edge 无头）
- `run_analysis_*.py`：数据分析闭环执行/汇总/保存

## 使用方式

1. 看结论：打开 `测试报告.md`。
2. 复核某项：按报告中的证据路径打开对应 json / txt / png / csv。
3. 复跑测试：先启动 Docker 服务、后端（uvicorn main:app --port 8000）、前端（pnpm dev），
   再按 tools/ 内脚本执行。

## 生成信息

- 日期：2026-09-08
- 环境：Docker Desktop（WSL2）+ DeepSeek LLM + Edge 无头浏览器
- 依赖：DeepSeek API Key（仅 `.env` 本地使用，未落盘于本目录）
- 结论：见 `测试报告.md`（P0 全通过；4 项 P1 缺陷已记录并附证据）
