# 电商问数智能体测试报告（2026-09-02）

> 本报告为独立测试记录，与用户提供的验收清单文件无关。清单勾选由用户自行维护。

## 环境

- 系统：Windows 11 家庭版（中文）
- Docker：Docker Desktop 4.89.0（WSL2 + VirtualMachinePlatform），数据目录挂载于 `F:\Docker`
- Python：uv 管理的 `.venv`（CPython 3.14.7，按 `uv.lock` 安装）；uv 位于 `F:\uv`
- LLM：DeepSeek 官方 API（`https://api.deepseek.com`，`deepseek-v4-flash`）
- Embedding：TEI（candle 后端，BAAI/bge-large-zh-v1.5，本地模型 1.2GB）
- 前端：Node 24 / pnpm 10.33 / Vite 6.4

## 服务状态

| 服务 | 地址 | 状态 |
|---|---|---|
| MySQL (dw/meta) | localhost:3307 | Up，dw 5 表 / meta 4 表，fact_order 115 行 |
| Elasticsearch 8.19.10 | localhost:9200 | Up，value_index 75 条（IK 分词） |
| Kibana 8.19.10 | localhost:5601 | Up |
| Qdrant v1.16 | localhost:6333 | Up，column_info 98 点 / metric_info 8 点 |
| Embedding (TEI) | localhost:8086 | Up，`/health` 200 |
| 后端 FastAPI | localhost:8000 | Up，`/docs` 200 |
| 前端 Vite | localhost:5173 | Up |

## 执行结果

### A1 后端质量检查

- Ruff：通过（`All checks passed!`）
- 单元测试：22/22 通过
- 发现并修复：`tests/test_query_evaluator.py` 读取 `evals/query_cases.json` 未指定编码，
  在 Windows（GBK 默认）下报 `UnicodeDecodeError`；改为 `encoding="utf-8"` 后通过。

### A2 前端构建

- `tsc --noEmit`：通过
- `vite build`：通过（1598 模块，产物约 227KB JS）

### A3 SQL 安全护栏

- `SELECT * FROM fact_order` → 自动追加 `LIMIT 1000`
- `DELETE`、多语句（`SELECT 1; DROP ...`）→ 抛出 SQLSafetyError，不返回可执行 SQL
- 单测覆盖注释 / DROP / UPDATE / 字符串内敏感词等场景：通过

### B2 数据与索引

- dw：dim_customer / dim_date / dim_product / dim_region / fact_order（115 行）
- meta：column_info(24) / column_metric(2) / metric_info(2) / table_info
- 华北 2025Q1 销售额 = **41099.5**（符合教学数据预期）
- 知识库索引已构建（`build_meta_knowledge`）：Qdrant 106 点、ES value_index 75 条

### E2 自动评测（30 用例 / 35 轮）

- **34/35 通过，通过率 97.1%**
- 报告：`evals/reports/latest.json`（含 summary 与 turns）
- 失败用例：`phone-category-sales`（“统计手机数码品类 2025 年第一季度销售额”）
  - 现象：`recall_column` 阶段 LLM 输出非法 JSON（OUTPUT_PARSING_FAILURE）→ 返回 SSE `error`，无 SQL
  - 复测：同查询重试成功（SQL 正确生成并执行）→ 判定为模型偶发输出格式问题，非系统性缺陷

### 手工冒烟（API 级）

- “统计华东地区 2025 年第一季度的销售总额” → 完整事件链 + 正确 SQL + result + analysis
  - SQL：`SUM(fo.order_amount)` JOIN dim_region/dim_date WHERE 华东 & 2025 & Q1 & LIMIT 1000
- “统计手机数码品类 2025 年第一季度销售额” → 重试通过

## 已知问题与备注

1. `fastapi dev` 在 Windows GBK 控制台打印 🚀 emoji 会崩，改用
   `uv run uvicorn main:app --host 0.0.0.0 --port 8000` + `PYTHONUTF8=1` 启动。
2. Docker Desktop 由非交互上下文（服务启动的 Codex 会话）拉起时，因无 EFS 密钥无法清理
   `docker-secrets-engine` 残留 socket；需用户从桌面双击启动。
3. Embedding 首次 warmup 约 2.5 分钟（candle 后端），`/health` 200 即正常；
   日志中 onnx 不存在属预期（TEI 自动回退 candle）。
4. 项目 pyproject 要求 Python>=3.14，系统 Python 3.13 不满足；统一用 uv `.venv` 运行。
5. 多轮记忆（P0）、SQL 校正闭环（D2）等行为已由评测集多轮用例覆盖并通过；
   前端图表 / CSV / 刷新恢复（F/G）依赖浏览器交互，需人工在 http://localhost:5173 验收。

## 待人工验收（浏览器）

- F1 分类对比图 / F2 趋势图 / F3 CSV 导出
- G1 刷新后会话恢复 / G2 新会话与重启边界
- C/D 前端进度展示与“已结合上下文理解为”气泡
