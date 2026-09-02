"""SQL 安全护栏的无数据库单元测试。"""

import asyncio
import unittest
from types import SimpleNamespace

from app.agent.nodes.guard_sql import guard_sql_node
from app.agent.sql_guardrail import SQLSafetyError, guard_sql


class SQLGuardrailTests(unittest.TestCase):
    def test_allows_select_and_adds_limit(self):
        self.assertEqual(
            guard_sql("SELECT * FROM fact_order"),
            "SELECT * FROM fact_order LIMIT 1000",
        )

    def test_preserves_existing_outer_limit(self):
        self.assertEqual(
            guard_sql("SELECT * FROM fact_order LIMIT 20;"),
            "SELECT * FROM fact_order LIMIT 20",
        )

    def test_adds_limit_when_only_subquery_has_limit(self):
        self.assertEqual(
            guard_sql("SELECT * FROM (SELECT * FROM fact_order LIMIT 1) AS sample"),
            "SELECT * FROM (SELECT * FROM fact_order LIMIT 1) AS sample LIMIT 1000",
        )

    def test_allows_cte_ending_in_select(self):
        sql = "WITH sales AS (SELECT * FROM fact_order) SELECT * FROM sales"
        self.assertEqual(guard_sql(sql), f"{sql} LIMIT 1000")

    def test_ignores_blocked_words_inside_string_literals(self):
        self.assertEqual(
            guard_sql("SELECT 'DROP TABLE' AS label"),
            "SELECT 'DROP TABLE' AS label LIMIT 1000",
        )

    def test_rejects_non_readonly_or_multi_statement_sql(self):
        for sql in (
            "DELETE FROM fact_order",
            "SELECT * FROM fact_order; DELETE FROM fact_order",
            "WITH changed AS (DELETE FROM fact_order) SELECT * FROM changed",
            "SHOW TABLES",
        ):
            with self.subTest(sql=sql):
                with self.assertRaises(SQLSafetyError):
                    guard_sql(sql)

    def test_rejects_comments(self):
        with self.assertRaises(SQLSafetyError):
            guard_sql("SELECT * FROM fact_order -- bypass")

    def test_guard_node_returns_error_event_without_raising(self):
        events = []
        runtime = SimpleNamespace(stream_writer=events.append)
        result = asyncio.run(guard_sql_node({"sql": "DROP TABLE fact_order"}, runtime))
        self.assertIn("仅允许执行 SELECT", result["error"])
        self.assertEqual(events[-1]["status"], "error")


if __name__ == "__main__":
    unittest.main()
