"""评测脚本的离线解析与断言测试。"""

import json
import unittest
from pathlib import Path

from app.scripts.evaluate_query_api import (
    evaluate_turn,
    parse_sse_events,
    summarize_report,
    validate_base_url,
)


class ValidateBaseUrlTests(unittest.TestCase):
    def test_accepts_http_and_https_and_strips_trailing_slash(self):
        self.assertEqual(validate_base_url("http://127.0.0.1:8000"), "http://127.0.0.1:8000")
        self.assertEqual(
            validate_base_url("https://api.example.com/"), "https://api.example.com"
        )

    def test_rejects_non_http_schemes(self):
        for url in ["ftp://127.0.0.1:8000", "file:///etc/passwd", "127.0.0.1:8000"]:
            with self.assertRaises(ValueError):
                validate_base_url(url)

    def test_rejects_embedded_credentials(self):
        with self.assertRaises(ValueError):
            validate_base_url("http://admin:secret@127.0.0.1:8000")

    def test_rejects_missing_host(self):
        with self.assertRaises(ValueError):
            validate_base_url("http://")


class QueryEvaluatorTests(unittest.TestCase):
    def test_eval_cases_cover_required_scenarios(self):
        cases = json.loads(Path("evals/query_cases.json").read_text(encoding="utf-8"))
        extra_path = Path("evals/query_cases_p3.json")
        if extra_path.exists():
            extra = json.loads(extra_path.read_text(encoding="utf-8"))
            cases = cases + extra
        turns = [turn for case in cases for turn in case["turns"]]
        # P3-A：评测集从 30 场景扩容至 80+（含模糊/多轮/空结果/越权/注入）
        self.assertGreaterEqual(len(cases), 80)
        self.assertGreaterEqual(len(turns), 85)
        self.assertGreaterEqual(
            sum("resolved_query_contains" in turn["expected"] for turn in turns), 5
        )
        self.assertGreaterEqual(
            sum(
                turn["expected"]["terminal_type"] == "assistant_message"
                for turn in turns
            ),
            10,
        )
        self.assertGreaterEqual(
            sum(turn["expected"]["terminal_type"] == "error" for turn in turns), 13
        )
        # 用例 id 必须全局唯一，避免报告聚合时互相覆盖
        case_ids = [case["id"] for case in cases]
        self.assertEqual(len(case_ids), len(set(case_ids)))

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
