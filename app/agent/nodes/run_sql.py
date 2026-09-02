"""
SQL 执行节点

负责执行最终 SQL，并记录查询结果。
它是当前 SQL 闭环的结束节点，执行完成后流程进入 END。
"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.state import DataAgentState
from app.core.log import logger


async def run_sql(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """执行 SQL 并产出最终问数结果"""

    writer = runtime.stream_writer
    step = "执行SQL"
    writer({"type": "progress", "step": step, "status": "running"})

    try:
        # 这里拿到的可能是 generate_sql 直接通过校验的 SQL，也可能是 correct_sql 覆盖后的 SQL
        sql = state["sql"]
        dw_mysql_repository = runtime.context["dw_mysql_repository"]

        # 真实数据库访问统一封装在仓储层，节点只负责从状态取 SQL 并触发执行
        result = await dw_mysql_repository.run(sql)
        logger.info(f"SQL执行结果：{result}")
        summary = f"已返回 {len(result)} 行结果" if result else "已返回空结果"
        writer({"type": "progress", "step": step, "status": "success"})
        # 仅在实际执行成功后公开最终 SQL，便于用户核对与后续离线评测。
        writer({"type": "sql", "sql": sql})
        writer({"type": "result", "data": result})
        # 只有成功的数据问数写入记忆；用户内容使用完整改写问题，便于继续追问。
        return {
            "result": result,
            "messages": [
                {"role": "user", "content": state["resolved_query"], "sql": None},
                {"role": "assistant", "content": summary, "sql": sql},
            ]
        }

    except Exception as e:
        logger.error(f"{step} failed: {e}")
        writer({"type": "progress", "step": step, "status": "error"})
        raise
