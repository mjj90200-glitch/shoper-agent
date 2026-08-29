"""非数据问题回复节点。

这些节点只生成确定性的产品引导文案，不访问模型、检索系统或数仓。
"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.state import DataAgentState

SUGGESTED_QUERIES = [
    "统计华北地区的销售总额",
    "统计 2025 年 3 月各商品品类的销量和销售额",
    "按会员等级统计 2025 年第一季度的订单数和销售额",
]


async def respond_capability(
    state: DataAgentState, runtime: Runtime[DataAgentContext]
):
    """说明产品能力，不进入检索或 SQL 流程。"""

    message = (
        "我是电商数据分析助手，专注于查询已接入数仓中的销售、订单、"
        "商品、地区和会员等经营数据。你可以直接描述想统计的指标、筛选条件"
        "和分析维度。"
    )
    event = {
        "type": "assistant_message",
        "category": "capability_help",
        "message": message,
        "suggested_queries": SUGGESTED_QUERIES,
    }
    runtime.stream_writer(event)
    return {
        "message": message,
        "suggested_queries": SUGGESTED_QUERIES,
    }


async def respond_out_of_scope(
    state: DataAgentState, runtime: Runtime[DataAgentContext]
):
    """礼貌说明边界，并将用户引导回可支持的数据分析问题。"""

    message = (
        "抱歉，我目前仅支持电商经营数据分析，无法处理通用知识、编程或其他"
        "领域的问题。你可以告诉我想查看的销售、订单、商品、地区或会员数据。"
    )
    event = {
        "type": "assistant_message",
        "category": "out_of_scope",
        "message": message,
        "suggested_queries": SUGGESTED_QUERIES,
    }
    runtime.stream_writer(event)
    return {
        "message": message,
        "suggested_queries": SUGGESTED_QUERIES,
    }
