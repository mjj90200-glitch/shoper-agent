# SQL 安全护栏与校验闭环（P1）

> 状态：已完成代码与无数据库自动化验证；真实 MySQL 端到端验证待 Docker 环境可用。

## 目标

确保 Agent 只会执行受限的只读分析查询，并让 SQL 修正重新进入完整校验闭环。

## 安全策略

- 仅允许单条 `SELECT` 或 `WITH ... SELECT`；
- 拒绝写操作、DDL、权限和会话控制关键字；
- 拒绝多语句和 SQL 注释；
- 外层查询未声明 `LIMIT` 时自动追加 `LIMIT 1000`；
- SQL 不安全、校验失败或一次修正后仍校验失败时，均不访问数仓。

## 新图流程

```text
generate_sql → guard_sql → validate_sql → run_sql
                    │            │
                    ▼            ▼
          respond_sql_rejected  correct_sql → guard_sql
```

`correct_sql` 最多执行一次；第二次校验失败时进入拒绝出口，避免无限循环。

## 改动文件

- `app/agent/sql_guardrail.py`：无数据库依赖的 SQL 分析与限行；
- `app/agent/nodes/guard_sql.py`：图节点；
- `app/agent/nodes/respond_sql_rejected.py`：安全拒绝 SSE 出口；
- `app/agent/graph.py`、`state.py`、`correct_sql.py`：闭环和重试次数；
- `tests/test_sql_guardrail.py`：放行、拦截、CTE、嵌套 LIMIT、自动限行测试。

## 待验证项

Docker 可用后，使用真实 API 验证：正常问数可以执行；模型生成危险 SQL 时仅收到 SSE `error`；生成错误 SQL 时最多修正一次且不会直接绕过校验。
