"""SQL 被安全护栏或校验闭环拒绝后的统一出口。"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.state import DataAgentState


async def respond_sql_rejected(
    state: DataAgentState, runtime: Runtime[DataAgentContext]
):
    """通过 SSE 返回错误，且不将失败查询写入会话记忆。"""

    message = state.get("error") or "SQL 校验未通过，未执行查询。"
    runtime.stream_writer({"type": "error", "message": message})
    return {"message": message}
