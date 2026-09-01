"""非数据问题统一回复节点。

此类请求不访问模型、检索系统或数仓，也不写入会话记忆。
"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.state import DataAgentState

NON_DATA_MESSAGE = (
    "抱歉，我目前仅支持电商经营数据分析。"
    "请描述你想查询的销售、订单、商品、地区或会员数据。"
)


async def respond_non_data(
    state: DataAgentState, runtime: Runtime[DataAgentContext]
):
    """统一回复非数据问题，并确保该轮不进入会话历史。"""

    event = {
        "type": "assistant_message",
        "category": "non_data",
        "message": NON_DATA_MESSAGE,
        "suggested_queries": [],
    }
    runtime.stream_writer(event)
    return {
        "message": NON_DATA_MESSAGE,
        "suggested_queries": [],
    }
