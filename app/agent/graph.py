"""
电商问数 Agent 图编排

使用 LangGraph 把问数智能体的各个节点串成一条可观测的执行链路
当前链路已经落地关键词抽取和多路召回，字段和指标走 Qdrant 向量检索，字段取值走 ES 全文检索
整体流程先抽取用户问题关键词，再并行召回字段 字段取值和指标信息，
随后合并召回结果 过滤候选表和指标 补充额外上下文，最后生成 校验 修正并执行 SQL
"""

import asyncio

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.constants import END, START
from langgraph.graph import StateGraph

from app.agent.context import DataAgentContext
from app.agent.nodes.add_extra_context import add_extra_context
from app.agent.nodes.analyze_result import analyze_result_node
from app.agent.nodes.classify_intent import classify_intent
from app.agent.nodes.correct_sql import correct_sql
from app.agent.nodes.extract_keywords import extract_keywords
from app.agent.nodes.filter_metric import filter_metric
from app.agent.nodes.filter_table import filter_table
from app.agent.nodes.generate_sql import generate_sql
from app.agent.nodes.guard_sql import guard_sql_node
from app.agent.nodes.merge_retrieved_info import merge_retrieved_info
from app.agent.nodes.recall_column import recall_column
from app.agent.nodes.recall_metric import recall_metric
from app.agent.nodes.recall_value import recall_value
from app.agent.nodes.respond_non_data import respond_non_data
from app.agent.nodes.respond_sql_rejected import respond_sql_rejected
from app.agent.nodes.rewrite_query import rewrite_query
from app.agent.nodes.run_sql import run_sql
from app.agent.nodes.validate_sql import validate_sql
from app.agent.state import DataAgentState
from app.auth.service import UserIdentity
from app.clients.embedding_client_manager import embedding_client_manager
from app.clients.es_client_manager import es_client_manager
from app.clients.mysql_client_manager import (
    dw_mysql_client_manager,
    meta_mysql_client_manager,
)
from app.clients.qdrant_client_manager import qdrant_client_manager
from app.repositories.es.value_es_repository import ValueESRepository
from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
from app.repositories.mysql.meta.meta_mysql_repository import MetaMySQLRepository
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository

# StateGraph 声明整张图使用的状态结构和运行时上下文结构
graph_builder = StateGraph(state_schema=DataAgentState, context_schema=DataAgentContext)

# 注册节点：每个节点负责问数链路中的一个清晰步骤
graph_builder.add_node("classify_intent", classify_intent)
graph_builder.add_node("rewrite_query", rewrite_query)
graph_builder.add_node("respond_non_data", respond_non_data)
graph_builder.add_node("extract_keywords", extract_keywords)
graph_builder.add_node("recall_column", recall_column)
graph_builder.add_node("recall_value", recall_value)
graph_builder.add_node("recall_metric", recall_metric)
graph_builder.add_node("merge_retrieved_info", merge_retrieved_info)
graph_builder.add_node("filter_metric", filter_metric)
graph_builder.add_node("filter_table", filter_table)
graph_builder.add_node("add_extra_context", add_extra_context)
graph_builder.add_node("generate_sql", generate_sql)
graph_builder.add_node("guard_sql", guard_sql_node)
graph_builder.add_node("validate_sql", validate_sql)
graph_builder.add_node("correct_sql", correct_sql)
graph_builder.add_node("run_sql", run_sql)
graph_builder.add_node("analyze_result", analyze_result_node)
graph_builder.add_node("respond_sql_rejected", respond_sql_rejected)

# 从用户问题开始，先判断是否属于电商数据分析。
# 非数据问题在此结束，确保不会触发 RAG、SQL 生成和数仓访问。
graph_builder.add_edge(START, "rewrite_query")
graph_builder.add_edge("rewrite_query", "classify_intent")
graph_builder.add_conditional_edges(
    source="classify_intent",
    path=lambda state: state["intent"],
    path_map={
        "data_query": "extract_keywords",
        "capability_help": "respond_non_data",
        "out_of_scope": "respond_non_data",
    },
)
graph_builder.add_edge("respond_non_data", END)

# 数据分析问题才进入原有的关键词抽取和多路召回链路。

# 关键词抽取后并行进入三类召回，分别面向字段 字段值和业务指标
graph_builder.add_edge("extract_keywords", "recall_column")
graph_builder.add_edge("extract_keywords", "recall_value")
graph_builder.add_edge("extract_keywords", "recall_metric")

# 三路召回都完成后，再进入统一的信息合并节点
graph_builder.add_edge("recall_column", "merge_retrieved_info")
graph_builder.add_edge("recall_value", "merge_retrieved_info")
graph_builder.add_edge("recall_metric", "merge_retrieved_info")

# 合并后的候选信息继续拆成表过滤和指标过滤两条线
graph_builder.add_edge("merge_retrieved_info", "filter_table")
graph_builder.add_edge("merge_retrieved_info", "filter_metric")

# 表和指标都过滤完成后，统一补充生成 SQL 所需的上下文
graph_builder.add_edge("filter_table", "add_extra_context")
graph_builder.add_edge("filter_metric", "add_extra_context")
graph_builder.add_edge("add_extra_context", "generate_sql")
graph_builder.add_edge("generate_sql", "guard_sql")
graph_builder.add_conditional_edges(
    source="guard_sql",
    path=lambda state: "validate_sql" if state["error"] is None else "respond_sql_rejected",
    path_map={
        "validate_sql": "validate_sql",
        "respond_sql_rejected": "respond_sql_rejected",
    },
)

# SQL 校验通过就直接执行，校验失败则先进入修正节点
graph_builder.add_conditional_edges(
    source="validate_sql",
    path=lambda state: (
        "run_sql"
        if state["error"] is None
        else "correct_sql"
        if state.get("sql_retry_count", 0) < 1
        else "respond_sql_rejected"
    ),
    path_map={
        "run_sql": "run_sql",
        "correct_sql": "correct_sql",
        "respond_sql_rejected": "respond_sql_rejected",
    },
)
graph_builder.add_edge("correct_sql", "guard_sql")
graph_builder.add_edge("run_sql", "analyze_result")
graph_builder.add_edge("analyze_result", END)
graph_builder.add_edge("respond_sql_rejected", END)

# `graph` 是单元测试和脚本的内存回退图；真实 API 会在 lifespan 中注入 SQLite
# Checkpointer 并通过 `get_graph()` 取得持久化实例。
graph = graph_builder.compile(checkpointer=InMemorySaver())
_persistent_graph = None


def configure_checkpointer(checkpointer: BaseCheckpointSaver) -> None:
    """使用应用生命周期持有的 Checkpointer 编译 API 运行图。"""

    global _persistent_graph
    _persistent_graph = graph_builder.compile(checkpointer=checkpointer)


def clear_persistent_graph() -> None:
    """关闭应用时释放对生命周期 Checkpointer 的图引用。"""

    global _persistent_graph
    _persistent_graph = None


def get_graph():
    """优先返回 SQLite 持久化图；未启动 API 时退回内存图。"""

    return _persistent_graph or graph

# print(graph.get_graph().draw_mermaid())

if __name__ == "__main__":

    async def test():
        """本地调试关键词抽取和字段 指标 取值三路召回链路"""

        # 多路召回和上下文补全会访问 Qdrant、Embedding、ES、Meta MySQL 和 DW MySQL
        qdrant_client_manager.init()
        embedding_client_manager.init()
        es_client_manager.init()
        meta_mysql_client_manager.init()
        dw_mysql_client_manager.init()

        # Meta MySQL 用来补齐元数据，DW MySQL 用来读取数据库方言和版本
        async with (
            meta_mysql_client_manager.session_factory() as meta_session,
            dw_mysql_client_manager.session_factory() as dw_session,
        ):
            meta_mysql_repository = MetaMySQLRepository(meta_session)
            dw_mysql_repository = DWMySQLRepository(dw_session)

            # 字段和指标分别使用不同 Qdrant collection，取值检索使用 ES index
            column_qdrant_repository = ColumnQdrantRepository(
                qdrant_client_manager.client
            )
            metric_qdrant_repository = MetricQdrantRepository(
                qdrant_client_manager.client
            )
            value_es_repository = ValueESRepository(es_client_manager.client)

            # 当前只需要传入原始问题，后续节点会逐步写回召回、过滤和额外上下文结果
            state = DataAgentState(query="统计华北地区的销售总额")
            context = DataAgentContext(
                column_qdrant_repository=column_qdrant_repository,
                embedding_client=embedding_client_manager.client,
                metric_qdrant_repository=metric_qdrant_repository,
                value_es_repository=value_es_repository,
                meta_mysql_repository=meta_mysql_repository,
                dw_mysql_repository=dw_mysql_repository,
                user=UserIdentity(
                    username="local_debug",
                    display_name="本地调试",
                    role="admin",
                    allowed_regions=(),
                    masked_fields=(),
                ),
            )

            # stream_mode="custom" 会接收各节点通过 runtime.stream_writer 写出的进度信息
            async for chunk in graph.astream(
                input=state,
                config={"configurable": {"thread_id": "local-debug"}},
                context=context,
                stream_mode="custom",
            ):
                print(chunk)

        # 关闭显式创建的异步客户端，避免本地调试时连接资源悬挂
        await qdrant_client_manager.close()
        await es_client_manager.close()
        await meta_mysql_client_manager.close()
        await dw_mysql_client_manager.close()

    asyncio.run(test())
