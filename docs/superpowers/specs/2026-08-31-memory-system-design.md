# P0 多轮会话记忆系统 — 设计文档

- 日期：2026-08-31
- 范围：`shopkeeper-agent` 电商问数 Agent 的第一阶段改造
- 状态：已定案，待实现

## 1. 背景与目标

当前项目是无状态单轮问答：`query` 进、SSE 出，没有会话概念（`app/agent/state.py` 里只有 `query` 一个输入字段）。用户每一次提问都从零开始，无法理解"那华北呢？"这类依赖上文的问题。

本次改造的目标是给问数 Agent 增加**多轮会话记忆**，让系统能够：

1. 记住当前会话的历史对话；
2. 对省略、指代类追问（"那华北呢？""按品牌再拆一下"）自动改写为完整、独立的问题；
3. 在多个会话之间做隔离（每个会话各自独立上下文）。

核心收益：用户无需反复重述统计口径、维度和筛选条件，问数更迅速、更自然。

## 2. 范围界定

**P0 只做短期会话记忆**，即"当前会话内的历史上下文"。以下能力不在本阶段，留待后续：

- 长期记忆（用户偏好、常用指标别名）—— 后续阶段
- 历史会话列表与回看（重启后恢复历史）—— 对应后续阶段「查询历史」
- 结果解读、可视化、语音 —— P1/P2/P3，均依赖本阶段打下的多轮模型

## 3. 方案选型

在三种候选方案中选定**方案三：LangGraph 原生 Checkpointer**，存储后端选用 **InMemorySaver**。

| 维度 | 结论 |
|---|---|
| 持久化机制 | LangGraph `thread_id` + `messages` 通道（自定义 `concat_messages` reducer 保持 dict 形态） |
| 存储后端 | `InMemorySaver`（零新依赖；重启后历史丢失可接受，留待历史回看阶段切 SQLite） |
| 改写节点位置 | `START → rewrite_query → classify_intent`，必须在意图识别之前 |

选择理由：框架原生、代码量少；checkpointer 只持久化 `state`（TypedDict 内存对象），不持久化 `context`（仓储/embedding 客户端仍为运行时注入），自然避免了"召回中间态混入会话记忆"的语义问题。

## 4. 状态设计

修改 `app/agent/state.py`：

```python
from typing import Annotated, Literal

class ChatMessageState(TypedDict):
    """跨轮累积的一条会话消息"""
    role: Literal["user", "assistant"]
    content: str                 # 文本内容；数据问题的 assistant 内容为结果精简摘要
    sql: str | None              # 数据问题：本轮生成的 SQL（user 消息为 None）

def concat_messages(
    left: list[ChatMessageState] | None,
    right: list[ChatMessageState] | None,
) -> list[ChatMessageState]:
    """拼接两轮消息，保持 dict 形态。

    不用 LangGraph 内置 add_messages：它会把 dict 转成 BaseMessage，
    导致自定义的 sql 字段丢失。
    """
    return (left or []) + (right or [])

class DataAgentState(TypedDict):
    query: str                                   # 当前轮原始问题（每轮覆盖）
    messages: Annotated[list[ChatMessageState], concat_messages]  # 跨轮唯一累积通道
    resolved_query: str                          # 改写后的独立问题
    # 以下字段不变：intent / message / suggested_queries / keywords /
    # retrieved_* / table_infos / metric_infos / date_info / db_info / sql / error
```

约定：

- `query` 是用户本轮的原始输入，用于前端展示与日志；
- `resolved_query` 是改写后的独立问题，供下游节点消费；
- `messages` 是唯一跨轮累积字段，其余字段每轮重新推导覆盖。

## 5. 图与节点改动

### 5.1 编译挂载 checkpointer（`app/agent/graph.py`）

```python
from langgraph.checkpoint.memory import InMemorySaver

graph = graph_builder.compile(checkpointer=InMemorySaver())
```

### 5.2 新增节点 `rewrite_query`（`app/agent/nodes/rewrite_query.py`）

- 输入：`state["query"]`（原始）+ `state["messages"]`（历史，不含本轮）。
- 无历史时：`resolved_query = query`，跳过 LLM 调用。
- 有历史时：用 LLM + `prompts/rewrite_query.prompt` 生成独立问题。
- 返回：`{"resolved_query": ..., "messages": [{"role": "user", "content": query}]}`，即写入改写结果并追加本轮用户消息。

### 5.3 边调整（`app/agent/graph.py`）

```
START → rewrite_query → classify_intent → ...
```

其余边保持不变。

### 5.4 消费 `resolved_query` 的节点

以下节点从读 `state["query"]` 改为读 `state["resolved_query"]`：

- `app/agent/nodes/classify_intent.py`
- `app/agent/nodes/extract_keywords.py`
- `app/agent/nodes/generate_sql.py`

### 5.5 追加 assistant 历史

- `app/agent/nodes/run_sql.py`：执行成功后返回 `{"messages": [{"role": "assistant", "content": 结果摘要, "sql": sql}]}`。
- `app/agent/nodes/respond_non_data.py`：`respond_capability` / `respond_out_of_scope` 返回 `{"messages": [{"role": "assistant", "content": message}]}`。

结果摘要使用非 LLM 的轻量格式化（如"返回 N 行，示例：…"），真正的 LLM 解读留待 P1。

## 6. API 与服务层

### 6.1 请求体（`app/api/schemas/query_schema.py`）

```python
class QuerySchema(BaseModel):
    query: str
    session_id: str
```

### 6.2 服务层（`app/services/query_service.py`）

- `QueryService.query(query, session_id)`；
- `graph.astream(input=state, config={"configurable": {"thread_id": session_id}}, context=context, stream_mode="custom")`；
- 无需手动读写历史，checkpointer 自动处理。

## 7. 前端改动

- `frontend/src/App.tsx`：新增 `sessionId` state，初始用 `crypto.randomUUID()` 生成；`clearConversation`（新会话）时重新生成 UUID。
- `frontend/src/lib/agentApi.ts`：`streamQuery` 请求体改为 `{ query, session_id }`，函数签名增加 `session_id` 参数。

## 8. 错误处理与边界

- 改写节点异常：降级为 `resolved_query = query`，不影响主链路；
- 历史窗口截断最近 N 轮（N=5），避免 prompt 过长；
- `messages` 仅在三条出口（data_query / capability_help / out_of_scope）追加，不残留脏历史；
- 流式接口异常处理逻辑保持不变。

## 9. 改动文件清单

| 类型 | 文件 |
|---|---|
| 新增 | `app/agent/nodes/rewrite_query.py` |
| 新增 | `prompts/rewrite_query.prompt` |
| 修改 | `app/agent/state.py` |
| 修改 | `app/agent/graph.py` |
| 修改 | `app/agent/nodes/classify_intent.py` |
| 修改 | `app/agent/nodes/extract_keywords.py` |
| 修改 | `app/agent/nodes/generate_sql.py` |
| 修改 | `app/agent/nodes/run_sql.py` |
| 修改 | `app/agent/nodes/respond_non_data.py` |
| 修改 | `app/api/schemas/query_schema.py` |
| 修改 | `app/services/query_service.py` |
| 修改 | `frontend/src/App.tsx` |
| 修改 | `frontend/src/lib/agentApi.ts` |

## 10. 验收标准

1. 首轮提问后，追问"那华北呢？"能正确改写为完整问题并返回数据（而非被判 out_of_scope）；
2. 两个不同 `session_id` 的会话互不干扰；
3. 刷新页面（前端重开新会话）后历史清空，但同一会话内连续追问有效；
4. 非数据问题（如"你好"）不会污染后续数据问题的历史；
5. 现有单轮问数功能不回退。
