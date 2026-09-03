"""SQLite Checkpointer 的持久化和 API 图切换测试。"""

import asyncio
import tempfile
import unittest
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.constants import END, START
from langgraph.graph import StateGraph

from app.agent.graph import (
    clear_persistent_graph,
    configure_checkpointer,
    get_graph,
    graph,
)


class CounterState(TypedDict):
    count: int


async def increment(state: CounterState) -> dict:
    return {"count": state["count"] + 1}


def build_counter_graph(checkpointer: AsyncSqliteSaver):
    builder = StateGraph(CounterState)
    builder.add_node("increment", increment)
    builder.add_edge(START, "increment")
    builder.add_edge("increment", END)
    return builder.compile(checkpointer=checkpointer)


class SqliteCheckpointerTests(unittest.TestCase):
    def test_checkpoint_survives_reopening_sqlite_connection(self):
        async def run(database_path: Path):
            config = {"configurable": {"thread_id": "admin:session-1"}}
            async with AsyncSqliteSaver.from_conn_string(str(database_path)) as saver:
                graph_with_sqlite = build_counter_graph(saver)
                await graph_with_sqlite.ainvoke({"count": 0}, config)

            async with AsyncSqliteSaver.from_conn_string(str(database_path)) as saver:
                graph_with_sqlite = build_counter_graph(saver)
                state = await graph_with_sqlite.aget_state(config)
                return state.values

        with tempfile.TemporaryDirectory() as directory:
            state = asyncio.run(run(Path(directory) / "checkpoints.sqlite"))
        self.assertEqual(state["count"], 1)

    def test_api_graph_uses_lifecycle_configured_checkpointer(self):
        async def run(database_path: Path):
            async with AsyncSqliteSaver.from_conn_string(str(database_path)) as saver:
                configure_checkpointer(saver)
                try:
                    return get_graph() is graph
                finally:
                    clear_persistent_graph()

        with tempfile.TemporaryDirectory() as directory:
            uses_fallback_graph = asyncio.run(
                run(Path(directory) / "checkpoints.sqlite")
            )
        self.assertFalse(uses_fallback_graph)
        self.assertIs(get_graph(), graph)


if __name__ == "__main__":
    unittest.main()
