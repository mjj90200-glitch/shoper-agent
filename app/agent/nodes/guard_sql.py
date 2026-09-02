"""SQL 安全护栏节点。"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.sql_guardrail import SQLSafetyError, guard_sql
from app.agent.state import DataAgentState
from app.core.log import logger


async def guard_sql_node(state: DataAgentState, runtime: Runtime[DataAgentContext]):
    """只允许安全的只读 SQL 进入数据库校验环节。"""

    writer = runtime.stream_writer
    step = "检查SQL安全"
    writer({"type": "progress", "step": step, "status": "running"})
    try:
        sql = guard_sql(state["sql"])
        writer({"type": "progress", "step": step, "status": "success"})
        return {"sql": sql, "error": None}
    except SQLSafetyError as error:
        message = str(error)
        logger.warning(message)
        writer({"type": "progress", "step": step, "status": "error"})
        return {"error": message}
