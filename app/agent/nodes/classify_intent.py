"""问数入口意图识别节点。

在检索、SQL 生成和数仓访问之前识别请求是否属于电商数据分析。
常见帮助和明显超范围问题走本地规则，不消耗模型调用；模糊表达才由
轻量 LLM 分类器兜底，避免非数据问题进入昂贵的 RAG 链路。
"""

from typing import Literal

from langchain_core.output_parsers import JsonOutputParser
from langchain_core.prompts import PromptTemplate
from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.llm import llm
from app.agent.state import DataAgentState
from app.core.log import logger
from app.prompt.prompt_loader import load_prompt

Intent = Literal["data_query", "capability_help", "out_of_scope"]

CAPABILITY_KEYWORDS = (
    "你可以做什么",
    "你能做什么",
    "能做什么",
    "你的功能",
    "功能介绍",
    "怎么使用",
    "如何使用",
    "使用说明",
    "帮助",
)

OUT_OF_SCOPE_KEYWORDS = (
    "你好",
    "您好",
    "天气",
    "新闻",
    "写代码",
    "编程",
    "java",
    "python",
    "翻译",
    "写一首",
    "讲个笑话",
)

# 数仓范围外的分析主题（P3-A 评测发现）：携带这些词的问题即使同时含有
# 数据关键词（如"商品""地区"），也必须跳过关键词短路交给 LLM 域分类，
# 避免把库存/利润等范围外主题编造成看似合理的查询。
OUT_OF_SCOPE_DOMAIN_KEYWORDS = (
    "库存",
    "利润",
    "成本",
    "退款",
    "退货",
    "物流",
    "签收",
    "广告",
    "投放",
    "流量",
    "访客",
    "竞品",
    "京东",
    "淘宝",
    "拼多多",
)

DATA_KEYWORDS = (
    "销售",
    "订单",
    "gmv",
    "成交",
    "销量",
    "销售额",
    "商品",
    "品类",
    "品牌",
    "地区",
    "大区",
    "会员",
    "客户",
    "收入",
    "客单价",
    "统计",
    "分析",
    "同比",
    "环比",
    # 口语化销售问法（P3-A 评测：华东卖得怎么样/啥东西卖得最好等）
    "卖",
    "畅销",
    "热销",
    "排行",
)


def classify_by_rule(query: str) -> Intent | None:
    """识别高置信度意图；返回 None 表示交给 LLM 做低成本兜底判断。"""

    normalized_query = query.lower().replace(" ", "")
    if any(keyword in normalized_query for keyword in CAPABILITY_KEYWORDS):
        return "capability_help"
    if any(keyword in normalized_query for keyword in OUT_OF_SCOPE_KEYWORDS):
        return "out_of_scope"
    # 范围外主题优先于数据关键词，防止"商品的库存"这类问法绕过域检查
    if any(keyword in normalized_query for keyword in OUT_OF_SCOPE_DOMAIN_KEYWORDS):
        return None
    if any(keyword in normalized_query for keyword in DATA_KEYWORDS):
        return "data_query"
    return None


def normalize_intent(value: object) -> Intent:
    """只接受图中已声明的三种意图，异常或未知结果安全降级为拒绝。"""

    if value in {"data_query", "capability_help", "out_of_scope"}:
        return value
    return "out_of_scope"


async def classify_intent(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """在入口处完成意图分类，确保非数据问题不会触发 RAG 或 SQL。"""

    writer = runtime.stream_writer
    step = "识别问题意图"
    writer({"type": "progress", "step": step, "status": "running"})

    try:
        query = state["resolved_query"]
        intent = classify_by_rule(query)

        if intent is None:
            prompt = PromptTemplate(
                template=load_prompt("classify_intent"), input_variables=["query"]
            )
            chain = prompt | llm | JsonOutputParser()
            result = await chain.ainvoke({"query": query})
            intent = normalize_intent(result.get("intent") if isinstance(result, dict) else None)

        logger.info(f"识别请求意图：{intent}")
        writer({"type": "progress", "step": step, "status": "success"})
        return {"intent": intent}
    except Exception as error:
        # 入口分类异常时不应误触发数据访问，安全降级到范围外回复。
        logger.error(f"识别问题意图失败: {error}")
        writer({"type": "progress", "step": step, "status": "error"})
        return {"intent": "out_of_scope"}
