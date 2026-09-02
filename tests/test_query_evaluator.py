"""评测脚本的离线解析与断言测试。"""

import json
import unittest
from pathlib import Path

from app.scripts.evaluate_query_api import (
    evaluate_turn,
    parse_sse_events,
    summarize_report,
)


class QueryEvaluatorTests(unittest.TestCase):
    def test_eval_cases_cover_required_scenarios(self):
        cases = json.loads(Path("evals/query_cases.json").read_text())
        turns = [turn for case in cases for turn in case["turns"]]
        self.assertEqual(len(cases), 30)
        self.assertEqual(len(turns), 35)
        self.assertGreaterEqual(
            sum("resolved_query_contains" in turn["expected"] for turn in turns), 5
        )
        self.assertGreaterEqual(
            sum(
                turn["expected"]["terminal_type"] == "assistant_message"
                for turn in turns
            ),
            4,
        )

    def test_parse_sse_events(self):
        events = parse_sse_events('data: {"type":"progress"}\n\ndata: {"type":"result","data":[]}\n\n')
        self.assertEqual([event["type"] for event in events], ["progress", "result"])

    def test_evaluate_turn_checks_context_and_sql(self):
        events = [
            {"type": "query_context", "resolved_query": "统计华北地区销售额"},
            {"type": "sql", "sql": "SELECT * FROM fact_order LIMIT 1000"},
            {"type": "result", "data": []},
        ]
        passed, errors = evaluate_turn(
            events,
            {
                "terminal_type": "result",
                "resolved_query_contains": ["华北", "销售"],
                "sql_contains": ["fact_order", "limit"],
            },
        )
        self.assertTrue(passed, errors)

    def test_summarize_report(self):
        summary = summarize_report(
            [
                {"case_id": "passed", "passed": True},
                {"case_id": "failed", "passed": False},
                {"case_id": "failed", "passed": False},
            ]
        )
        self.assertEqual(summary["total_turns"], 3)
        self.assertEqual(summary["pass_rate"], 1 / 3)
        self.assertEqual(summary["failed_case_ids"], ["failed"])


if __name__ == "__main__":
    unittest.main()
