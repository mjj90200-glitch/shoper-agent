"""
电商问数 Agent 状态定义

State 是 LangGraph 各节点之间传递和更新的共享数据
本章在用户原始问题之外，新增关键词列表和三路召回结果
并把召回到的实体整理成后续提示词更容易消费的表信息和指标信息
SQL 生成闭环会继续写入候选 SQL 以及校验错误信息，用于控制校正或执行分支
"""

from typing import Annotated, Literal, TypedDict

from app.agent.result_analysis import ResultAnalysis
from app.entities.column_info import ColumnInfo
from app.entities.metric_info import MetricInfo
from app.entities.value_info import ValueInfo


class ChatMessageState(TypedDict):
    """一条可用于后续数据追问改写的会话消息。"""

    role: Literal["user", "assistant"]
    content: str
    sql: str | None


def concat_messages(
    left: list[ChatMessageState] | None,
    right: list[ChatMessageState] | None,
) -> list[ChatMessageState]:
    """累积会话消息，并保留 SQL 这一自定义字段。"""

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

    query: str  # 用户本轮原始输入，用于日志和前端展示
    # 仅保存成功数据问数的历史，供后续追问改写使用。
    messages: Annotated[list[ChatMessageState], concat_messages]
    # 由 rewrite_query 补全上下文后的独立问题，供下游节点统一消费。
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

    error: str | None  # SQL 安全检查或校验时出现的错误信息
    sql_retry_count: int  # 当前轮 SQL 修正次数，防止校正失败后无限循环
    result: list[dict]  # 数据库实际返回的结果，仅用于本轮展示与解读
    analysis: ResultAnalysis  # 基于真实结果生成的确定性摘要与图表规格
