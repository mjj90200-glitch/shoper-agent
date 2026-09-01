"""P0 多轮会话记忆的基础行为测试。"""

import asyncio
import os
import unittest
import uuid
from types import SimpleNamespace

os.environ.setdefault("LLM_API_KEY", "test-key")

from app.agent.nodes.respond_non_data import NON_DATA_MESSAGE, respond_non_data
from app.agent.nodes.rewrite_query import format_history, recent_history
from app.agent.state import concat_messages


class MemoryStateTests(unittest.TestCase):
    def test_concat_messages_preserves_custom_sql_field(self):
        result = concat_messages(
            [{"role": "user", "content": "统计销售额", "sql": None}],
            [{"role": "assistant", "content": "已返回 1 行结果", "sql": "select 1"}],
        )
        self.assertEqual(len(result), 2)
        self.assertEqual(result[1]["sql"], "select 1")

    def test_history_is_limited_to_latest_five_rounds(self):
        messages = [
            {"role": "user", "content": f"问题 {index}", "sql": None}
            for index in range(12)
        ]
        self.assertEqual(len(recent_history(messages)), 10)
        self.assertEqual(recent_history(messages)[0]["content"], "问题 2")

    def test_history_format_includes_sql(self):
        history = format_history(
            [
                {"role": "user", "content": "统计华东销售额", "sql": None},
                {"role": "assistant", "content": "已返回 1 行结果", "sql": "select 1"},
            ]
        )
        self.assertIn("用户：统计华东销售额", history)
        self.assertIn("SQL：select 1", history)


class NonDataResponseTests(unittest.TestCase):
    def test_non_data_response_does_not_return_messages(self):
        events = []
        runtime = SimpleNamespace(stream_writer=events.append)
        result = asyncio.run(respond_non_data({}, runtime))
        self.assertNotIn("messages", result)
        self.assertEqual(result["message"], NON_DATA_MESSAGE)
        self.assertEqual(events[0]["category"], "non_data")

    def test_non_data_turn_leaves_checkpointer_history_empty(self):
        from app.agent.graph import graph

        async def run():
            thread_id = str(uuid.uuid4())
            async for _ in graph.astream(
                {"query": "你好"},
                config={"configurable": {"thread_id": thread_id}},
                context={},
                stream_mode="custom",
            ):
                pass
            state = await graph.aget_state(
                {"configurable": {"thread_id": thread_id}}
            )
            return state.values.get("messages")

        self.assertEqual(asyncio.run(run()), [])


if __name__ == "__main__":
    unittest.main()
