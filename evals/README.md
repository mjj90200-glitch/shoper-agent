# 问数 Agent 评测集

`query_cases.json` 当前包含 30 个标准场景、35 轮请求：单轮指标与维度问数、多维拆分、5 类追问以及非数据边界。

Docker、后端和前端服务均可用后，在项目根目录执行：

```bash
uv run python -m app.scripts.evaluate_query_api
```

脚本会为每个场景生成独立 `session_id`，同一场景中的追问共享会话。报告默认输出到 `evals/reports/latest.json`，包含逐轮 SSE 事件和汇总指标：总轮数、通过轮数、失败轮数、通过率、失败用例 ID。

评测不是替代人工审查：`sql_contains` 仅验证关键表/安全上限等最低约束。每次模型、Prompt、元数据或检索策略变化后，应抽查失败样本和关键业务结果。
