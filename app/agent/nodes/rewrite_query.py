"""追问改写节点。

只读取同一会话中已成功完成的数据问数历史，不在此阶段写入消息。
这样非数据问题不会污染后续问数的上下文。
"""

from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import PromptTemplate
from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.llm import llm
from app.agent.state import ChatMessageState, DataAgentState
from app.core.log import logger
from app.prompt.prompt_loader import load_prompt

MAX_HISTORY_MESSAGES = 10


def recent_history(messages: list[ChatMessageState]) -> list[ChatMessageState]:
    """只保留最近五轮有效问数，避免改写 Prompt 无限制增长。"""

    return messages[-MAX_HISTORY_MESSAGES:]


def format_history(messages: list[ChatMessageState]) -> str:
    """将历史转换为 Prompt 可读且包含最终 SQL 的文本。"""

    lines: list[str] = []
    for message in recent_history(messages):
        role = "用户" if message["role"] == "user" else "助手"
        lines.append(f"{role}：{message['content']}")
        if message["sql"]:
            lines.append(f"SQL：{message['sql']}")
    return "\n".join(lines)


async def rewrite_query(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """将依赖上下文的追问改写为独立问题；失败时安全降级。"""

    writer = runtime.stream_writer
    step = "理解上下文"
    writer({"type": "progress", "step": step, "status": "running"})

    query = state["query"]
    history = state.get("messages", [])
    try:
        if not history:
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

        logger.info(f"改写后的问题：{resolved_query}")
        writer({"type": "progress", "step": step, "status": "success"})
        return {"resolved_query": resolved_query}
    except Exception as error:
        logger.error(f"追问改写失败，使用原始问题: {error}")
        writer({"type": "progress", "step": step, "status": "error"})
        return {"resolved_query": query}
