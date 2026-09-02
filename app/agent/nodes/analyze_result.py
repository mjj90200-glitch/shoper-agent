"""查询结果确定性解读节点。"""

from langgraph.runtime import Runtime

from app.agent.context import DataAgentContext
from app.agent.result_analysis import analyze_result
from app.agent.state import DataAgentState


async def analyze_result_node(
    state: DataAgentState, runtime: Runtime[DataAgentContext]
):
    """基于实际数据库返回值生成摘要和图表规格，不额外调用 LLM。"""

    writer = runtime.stream_writer
    step = "解读查询结果"
    writer({"type": "progress", "step": step, "status": "running"})
    analysis = analyze_result(state["result"])
    writer({"type": "analysis", **analysis})
    writer({"type": "progress", "step": step, "status": "success"})
    return {"analysis": analysis}
