# 多轮会话记忆系统 (P0) 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给电商问数 Agent 增加基于 LangGraph Checkpointer 的多轮会话记忆与追问改写能力。

**Architecture:** 用 `InMemorySaver` 作为 checkpointer，`thread_id` 作为会话 ID；状态中新增 `messages` 通道（自定义 `concat_messages` reducer 跨轮累积）和 `resolved_query`（改写后问题）。新增 `rewrite_query` 节点插在意图识别之前，把"那华北呢？"改写为独立问题。

**Tech Stack:** LangGraph（checkpointer / reducer）、LangChain（LLM + Prompt）、FastAPI（SSE）、React（session_id 前端管理）。

**说明：** 本项目目前无 `tests/` 目录，测试由其他成员负责。因此每个任务用「导入编译检查 + 手动验证」代替单元测试，TDD 的"先写失败测试"步骤替换为"运行导入检查确认无语法/装配错误"。

---

## 文件结构

| 类型 | 文件 | 职责 |
|---|---|---|
| 新增 | `app/agent/nodes/rewrite_query.py` | 追问改写节点 |
| 新增 | `prompts/rewrite_query.prompt` | 改写提示词 |
| 修改 | `app/agent/state.py` | 新增 `ChatMessageState`、`concat_messages`、`messages`、`resolved_query` |
| 修改 | `app/agent/graph.py` | 挂载 checkpointer、注册 rewrite 节点、调整起始边 |
| 修改 | `app/agent/nodes/classify_intent.py` | 改读 `resolved_query` |
| 修改 | `app/agent/nodes/extract_keywords.py` | 改读 `resolved_query` |
| 修改 | `app/agent/nodes/generate_sql.py` | 改读 `resolved_query` |
| 修改 | `app/agent/nodes/correct_sql.py` | 改读 `resolved_query` |
| 修改 | `app/agent/nodes/run_sql.py` | 追加 assistant 历史 |
| 修改 | `app/agent/nodes/respond_non_data.py` | 追加 assistant 历史 |
| 修改 | `app/api/schemas/query_schema.py` | 请求体加 `session_id` |
| 修改 | `app/api/routers/query_router.py` | 透传 `session_id` |
| 修改 | `app/services/query_service.py` | `astream` 传入 thread_id |
| 修改 | `frontend/src/lib/agentApi.ts` | 请求体加 `session_id` |
| 修改 | `frontend/src/App.tsx` | 管理并传递 `sessionId` |

---

## Task 1: 状态定义扩展

**Files:**
- Modify: `app/agent/state.py`

- [ ] **Step 1: 改写 `app/agent/state.py`**

将整个文件替换为以下内容（在原有基础上新增 `ChatMessageState`、`concat_messages`、`messages`、`resolved_query`，其余字段保持不变）：

```python
"""
电商问数 Agent 状态定义

State 是 LangGraph 各节点之间传递和更新的共享数据
本章在用户原始问题之外，新增关键词列表和三路召回结果
并把召回到的实体整理成后续提示词更容易消费的表信息和指标信息
SQL 生成闭环会继续写入候选 SQL 以及校验错误信息，用于控制校正或执行分支

多轮记忆改造：新增 messages 通道（跨轮累积）和 resolved_query（改写后问题）
"""

from typing import Annotated, Literal, TypedDict

from app.entities.column_info import ColumnInfo
from app.entities.metric_info import MetricInfo
from app.entities.value_info import ValueInfo


class ChatMessageState(TypedDict):
    """跨轮累积的一条会话消息"""

    role: Literal["user", "assistant"]
    content: str
    sql: str | None


def concat_messages(
    left: list[ChatMessageState] | None,
    right: list[ChatMessageState] | None,
) -> list[ChatMessageState]:
    """拼接两轮消息，保持 dict 形态。

    不用 LangGraph 内置 add_messages：它会把 dict 转成 BaseMessage，
    导致自定义的 sql 字段丢失。
    """
    return (left or []) + (right or [])


class MetricInfoState(TypedDict):
    """面向 SQL 生成提示词的指标信息"""

    name: str
    description: str
    # 指标依赖的字段 id，用来提示模型不要脱离业务口径随意计算
    relevant_columns: list[str]
    alias: list[str]


class ColumnInfoState(TypedDict):
    """表上下文中的字段信息"""

    name: str
    type: str
    role: str
    # 字段真实样例值，尤其用于辅助 where 条件里的枚举值选择
    examples: list
    description: str
    alias: list[str]


class TableInfoState(TypedDict):
    """SQL 生成阶段真正传给模型的表结构上下文"""

    name: str
    role: str
    description: str
    columns: list[ColumnInfoState]


class DateInfoState(TypedDict):
    """SQL 生成阶段使用的当前日期上下文"""

    date: str
    weekday: str
    quarter: str


class DBInfoState(TypedDict):
    """SQL 生成阶段使用的数据库环境信息"""

    dialect: str
    version: str


class DataAgentState(TypedDict):
    """一次问数链路中的核心状态"""

    query: str  # 用户输入的原始查询（当前轮）
    # 跨轮累积的会话历史，是本阶段唯一跨轮保留的字段
    messages: Annotated[list[ChatMessageState], concat_messages]
    # 改写后、不依赖上下文的独立问题，下游节点消费这个字段
    resolved_query: str
    # 在进入 RAG 和 SQL 链路前确定用户请求的类型，用于控制图的入口分流。
    intent: Literal["data_query", "capability_help", "out_of_scope"]
    # 非数据问题的最终文本回复及推荐示例问题。
    message: str
    suggested_queries: list[str]
    keywords: list[str]  # 抽取的关键词
    retrieved_column_infos: list[ColumnInfo]  # 检索到的字段信息
    retrieved_metric_infos: list[MetricInfo]  # 检索到的指标信息
    retrieved_value_infos: list[ValueInfo]  # 检索到的取值信息

    table_infos: list[TableInfoState]  # 合并和补齐后的表结构上下文
    metric_infos: list[MetricInfoState]  # 合并后的指标上下文
    date_info: DateInfoState  # 当前日期 星期和季度信息
    db_info: DBInfoState  # 数据库方言和版本信息

    sql: str  # 生成或校正后的SQL

    error: str  # 校验SQL时出现的错误信息
```

- [ ] **Step 2: 验证导入无错误**

Run: `uv run python -c "from app.agent.state import DataAgentState, concat_messages; print(concat_messages([{'role':'user','content':'a','sql':None}], [{'role':'assistant','content':'b','sql':'select 1'}]))"`
Expected: 打印出包含两条 dict 的列表，且 dict 仍保留 `sql` 字段（未被转成 BaseMessage）。

- [ ] **Step 3: Commit**

```bash
git add app/agent/state.py
git commit -m "feat(memory): 状态新增 messages 通道与 resolved_query"
```

---

## Task 2: 追问改写提示词与节点

**Files:**
- Create: `prompts/rewrite_query.prompt`
- Create: `app/agent/nodes/rewrite_query.py`

- [ ] **Step 1: 创建 `prompts/rewrite_query.prompt`**

内容（末尾保留一个换行）：

```text
你是电商数据分析助手的「上下文理解」模块。请根据对话历史，把用户当前的问题改写成一个独立、完整、不再依赖上下文的问题。

改写规则：
1. 补全历史中已出现的维度、指标、筛选条件、时间范围等被省略的信息；
2. 解析指代词（例如"那"、"它"、"上一个"），回指历史里对应的实体；
3. 不改变用户本意，不添加用户没有要求的新分析；
4. 如果当前问题已经独立完整，原样输出即可；
5. 只输出改写后的问题，不要输出解释或额外文字。

对话历史：
{history}

用户当前问题：
{query}

改写后的问题：
```

- [ ] **Step 2: 创建 `app/agent/nodes/rewrite_query.py`**

```python
"""
追问改写节点

负责在意图识别之前，结合会话历史把用户当前问题改写成独立完整的问题。
无历史时直接透传，避免额外模型调用；改写失败时降级为原始问题。
"""

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.llm import llm
from app.agent.state import DataAgentState
from app.core.log import logger
from app.prompt.prompt_loader import load_prompt


def format_history(history: list[dict]) -> str:
    """把会话历史格式化成改写提示词可读的文本"""
    lines = []
    for message in history:
        role = "用户" if message["role"] == "user" else "助手"
        lines.append(f"{role}：{message['content']}")
        if message.get("sql"):
            lines.append(f"  SQL：{message['sql']}")
    return "\n".join(lines)


async def rewrite_query(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """改写当前问题，并把本轮用户消息追加进会话历史"""

    writer = runtime.stream_writer
    step = "理解上下文"
    writer({"type": "progress", "step": step, "status": "running"})

    query = state["query"]
    history = state.get("messages", [])

    try:
        if not history:
            # 首轮无历史，直接透传，跳过模型调用
            resolved_query = query
        else:
            prompt = PromptTemplate(
                template=load_prompt("rewrite_query"),
                input_variables=["history", "query"],
            )
            chain = prompt | llm | StrOutputParser()
            resolved_query = (
                await chain.ainvoke({"history": format_history(history), "query": query})
            ).strip() or query

        writer({"type": "progress", "step": step, "status": "success"})
        logger.info(f"改写后的问题：{resolved_query}")
        return {
            "resolved_query": resolved_query,
            "messages": [{"role": "user", "content": query, "sql": None}],
        }
    except Exception as e:
        # 改写失败不影响主链路，降级为原始问题
        logger.error(f"追问改写失败，降级为原始问题: {e}")
        writer({"type": "progress", "step": step, "status": "error"})
        return {
            "resolved_query": query,
            "messages": [{"role": "user", "content": query, "sql": None}],
        }
```

- [ ] **Step 3: 验证导入无错误**

Run: `uv run python -c "from app.agent.nodes.rewrite_query import rewrite_query, format_history; print(format_history([{'role':'user','content':'统计华东销售','sql':None},{'role':'assistant','content':'返回3行','sql':'select 1'}]))"`
Expected: 打印多行文本，包含"用户：统计华东销售"和"SQL：select 1"。

- [ ] **Step 4: Commit**

```bash
git add prompts/rewrite_query.prompt app/agent/nodes/rewrite_query.py
git commit -m "feat(memory): 新增追问改写节点与提示词"
```

---

## Task 3: 图编排挂载 checkpointer 与改写节点

**Files:**
- Modify: `app/agent/graph.py`

- [ ] **Step 1: 新增 import**

在 `app/agent/graph.py` 顶部，把两处 import 改为：

```python
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.constants import END, START
from langgraph.graph import StateGraph
```

在节点 import 区域（`from app.agent.nodes.recall_value import recall_value` 之后）新增一行：

```python
from app.agent.nodes.rewrite_query import rewrite_query
```

- [ ] **Step 2: 注册 rewrite 节点**

在 `graph_builder.add_node("respond_out_of_scope", respond_out_of_scope)` 之后新增一行：

```python
graph_builder.add_node("rewrite_query", rewrite_query)
```

- [ ] **Step 3: 调整起始边**

把：

```python
graph_builder.add_edge(START, "classify_intent")
```

改为：

```python
graph_builder.add_edge(START, "rewrite_query")
graph_builder.add_edge("rewrite_query", "classify_intent")
```

- [ ] **Step 4: 挂载 checkpointer**

把：

```python
graph = graph_builder.compile()
```

改为：

```python
graph = graph_builder.compile(checkpointer=InMemorySaver())
```

- [ ] **Step 5: 验证图可编译**

Run: `uv run python -c "from app.agent.graph import graph; print(graph.get_graph().draw_mermaid())"`
Expected: 输出 mermaid 图，起始边为 `START → rewrite_query → classify_intent`。

- [ ] **Step 6: Commit**

```bash
git add app/agent/graph.py
git commit -m "feat(memory): 图编排挂载 checkpointer 并接入改写节点"
```

---

## Task 4: 下游节点改读 resolved_query

**Files:**
- Modify: `app/agent/nodes/classify_intent.py`
- Modify: `app/agent/nodes/extract_keywords.py`
- Modify: `app/agent/nodes/generate_sql.py`
- Modify: `app/agent/nodes/correct_sql.py`

这四个文件都有一行 `query = state["query"]`，统一改为 `query = state["resolved_query"]`。

- [ ] **Step 1: 修改 `classify_intent.py`**

把 `classify_intent` 函数内的：

```python
        query = state["query"]
```

改为：

```python
        query = state["resolved_query"]
```

- [ ] **Step 2: 修改 `extract_keywords.py`**

把 `extract_keywords` 函数内的：

```python
        query = state["query"]
```

改为：

```python
        query = state["resolved_query"]
```

- [ ] **Step 3: 修改 `generate_sql.py`**

把 `generate_sql` 函数内的：

```python
        query = state["query"]
```

改为：

```python
        query = state["resolved_query"]
```

- [ ] **Step 4: 修改 `correct_sql.py`**

把 `correct_sql` 函数内的：

```python
        query = state["query"]
```

改为：

```python
        query = state["resolved_query"]
```

- [ ] **Step 5: 验证导入无错误**

Run: `uv run python -c "from app.agent import graph"`
Expected: 无报错退出。

- [ ] **Step 6: Commit**

```bash
git add app/agent/nodes/classify_intent.py app/agent/nodes/extract_keywords.py app/agent/nodes/generate_sql.py app/agent/nodes/correct_sql.py
git commit -m "feat(memory): 下游节点改读 resolved_query"
```

---

## Task 5: 结束节点追加 assistant 历史

**Files:**
- Modify: `app/agent/nodes/run_sql.py`
- Modify: `app/agent/nodes/respond_non_data.py`

- [ ] **Step 1: 修改 `run_sql.py`**

把 `run_sql` 函数内的 try 块（从 `result = await dw_mysql_repository.run(sql)` 到 `writer({"type": "result", "data": result})` 之间的部分）改为：

```python
        result = await dw_mysql_repository.run(sql)
        logger.info(f"SQL执行结果行数：{len(result)}")

        summary = f"已返回 {len(result)} 行结果" if result else "已返回空结果"

        writer({"type": "progress", "step": step, "status": "success"})
        writer({"type": "result", "data": result})
        return {
            "messages": [{"role": "assistant", "content": summary, "sql": sql}]
        }
```

> 注意：`run_sql` 是 `generate_sql`/`correct_sql` 之后最终执行的节点，此处 `sql` 就是校验通过或修正后的最终 SQL。

- [ ] **Step 2: 修改 `respond_non_data.py`**

`respond_capability` 的 return 改为：

```python
    return {
        "message": message,
        "suggested_queries": SUGGESTED_QUERIES,
        "messages": [{"role": "assistant", "content": message, "sql": None}],
    }
```

`respond_out_of_scope` 的 return 改为：

```python
    return {
        "message": message,
        "suggested_queries": SUGGESTED_QUERIES,
        "messages": [{"role": "assistant", "content": message, "sql": None}],
    }
```

- [ ] **Step 3: 验证导入无错误**

Run: `uv run python -c "from app.agent import graph"`
Expected: 无报错退出。

- [ ] **Step 4: Commit**

```bash
git add app/agent/nodes/run_sql.py app/agent/nodes/respond_non_data.py
git commit -m "feat(memory): 结束节点追加 assistant 历史消息"
```

---

## Task 6: API 层透传 session_id

**Files:**
- Modify: `app/api/schemas/query_schema.py`
- Modify: `app/api/routers/query_router.py`
- Modify: `app/services/query_service.py`

- [ ] **Step 1: 修改 `query_schema.py`**

把 `QuerySchema` 类改为：

```python
class QuerySchema(BaseModel):
    """`/api/query` 请求体，承载用户输入的自然语言问题和会话 ID"""

    # 前端请求体中的 query 字段，例如 {"query": "统计华北地区销售额"}
    query: str
    # 会话 ID，前端生成并透传；同一次会话内保持相同，用于多轮记忆
    session_id: str
```

- [ ] **Step 2: 修改 `query_router.py`**

把：

```python
        query_service.query(query.query),
```

改为：

```python
        query_service.query(query.query, query.session_id),
```

- [ ] **Step 3: 修改 `query_service.py`**

把 `query` 方法签名和 `graph.astream` 调用改为：

```python
    async def query(self, query: str, session_id: str):
        """执行一次问数工作流，并逐段产出 SSE 消息"""
        state = DataAgentState(query=query)
        context = DataAgentContext(
            column_qdrant_repository=self.column_qdrant_repository,
            embedding_client=self.embedding_client,
            metric_qdrant_repository=self.metric_qdrant_repository,
            value_es_repository=self.value_es_repository,
            meta_mysql_repository=self.meta_mysql_repository,
            dw_mysql_repository=self.dw_mysql_repository,
        )
        try:
            async for chunk in graph.astream(
                input=state,
                config={"configurable": {"thread_id": session_id}},
                context=context,
                stream_mode="custom",
            ):
                yield f"data: {json.dumps(chunk, ensure_ascii=False, default=str)}\n\n"
        except Exception as e:
            error = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(error, ensure_ascii=False, default=str)}\n\n"
```

- [ ] **Step 4: 验证导入无错误**

Run: `uv run python -c "from app.api.routers.query_router import query_router; from app.services.query_service import QueryService; print('ok')"`
Expected: 打印 `ok`。

- [ ] **Step 5: Commit**

```bash
git add app/api/schemas/query_schema.py app/api/routers/query_router.py app/services/query_service.py
git commit -m "feat(memory): API 层透传 session_id 到 checkpointer"
```

---

## Task 7: 前端管理并传递 session_id

**Files:**
- Modify: `frontend/src/lib/agentApi.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: 修改 `agentApi.ts`**

`QueryOptions` 类型和 `streamQuery` 函数改为：

```typescript
type QueryOptions = {
  sessionId: string;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
};

export async function streamQuery(query: string, options: QueryOptions) {
  const response = await fetch(`${API_BASE_URL}/api/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ query, session_id: options.sessionId }),
    signal: options.signal,
  });
  // ... 其余保持不变
}
```

> 注意：`streamQuery` 后续的 `response.ok` 检查、`reader` 读取、`parseSseChunk` 逻辑保持不变，只改 `QueryOptions` 类型和 `body`。

- [ ] **Step 2: 修改 `App.tsx`**

2.1 在组件内新增 `sessionId` state（放在 `draft` state 附近）：

```typescript
  const [sessionId, setSessionId] = useState(() => makeId());
```

2.2 `clearConversation` 改为同时重置会话：

```typescript
  const clearConversation = () => {
    if (isStreaming) return;
    setMessages([]);
    setDraft("");
    setSessionId(makeId());
  };
```

2.3 `streamQuery` 调用处加上 `sessionId`：

```typescript
      await streamQuery(query, { sessionId, signal: controller.signal, onEvent });
```

- [ ] **Step 3: 验证前端类型检查**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: 无类型错误。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/agentApi.ts frontend/src/App.tsx
git commit -m "feat(memory): 前端管理并传递 session_id"
```

---

## Task 8: 端到端手动验证

- [ ] **Step 1: 启动后端与基础服务**

```bash
docker compose -f docker/docker-compose.yaml up -d
uv run fastapi dev main.py --host 0.0.0.0 --port 8000
```

- [ ] **Step 2: 首轮提问（华东销售）**

```bash
curl -N -X POST http://127.0.0.1:8000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"统计华东地区2025年第一季度的销售总额","session_id":"test-session-001"}'
```

Expected: SSE 依次输出 `progress` 与 `result`，最终 SQL 含华东地区条件。

- [ ] **Step 3: 追问（省略主语）**

```bash
curl -N -X POST http://127.0.0.1:8000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"那华北呢？","session_id":"test-session-001"}'
```

Expected: 输出中出现 `progress` 步骤「理解上下文」，最终 SQL 含华北地区条件（而非返回 out_of_scope 的 assistant_message）。

- [ ] **Step 4: 会话隔离验证**

```bash
curl -N -X POST http://127.0.0.1:8000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query":"那华北呢？","session_id":"test-session-002"}'
```

Expected: 新会话无历史，「那华北呢？」无法被改写，返回 out_of_scope 的 `assistant_message`（或非华北语义的结果），证明不同 session 互不干扰。

- [ ] **Step 5: 提交（如验证过程中有微调）**

```bash
git add -A
git commit -m "chore(memory): 端到端验证微调"
```

---

## 自审记录

- **Spec 覆盖**：设计文档 10 条验收标准均已映射到 Task 8 的端到端验证；状态、图、节点、API、前端改动均有对应 Task。
- **占位符扫描**：无 TBD/TODO；所有代码步骤均给出完整代码。
- **类型一致性**：`ChatMessageState` 的 `role/content/sql` 字段在 Task 1 定义、Task 2（rewrite）与 Task 5（run_sql/respond）中引用一致；`resolved_query` 在 Task 1 定义、Task 2 写入、Task 4 读取一致；`session_id` 在 Task 6/7 的 schema、service、前端三处命名一致（后端 `session_id`、前端 `sessionId` 为语言风格差异，接口 JSON 统一为 `session_id`）。
