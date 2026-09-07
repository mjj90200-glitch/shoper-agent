"""查询结果确定性解读的离线测试。"""

import asyncio
import unittest
from decimal import Decimal
from types import SimpleNamespace

from app.agent.nodes.analyze_result import analyze_result_node
from app.agent.result_analysis import analyze_result


class ResultAnalysisTests(unittest.TestCase):
    def test_empty_result_has_no_chart(self):
        self.assertEqual(
            analyze_result([]),
            {"summary": "查询完成，结果为空。", "chart": None},
        )

    def test_category_result_becomes_bar_chart(self):
        analysis = analyze_result(
            [
                {"region_name": "华东", "total_sales": 1200},
                {"region_name": "华北", "total_sales": 800},
            ]
        )
        self.assertEqual(analysis["chart"]["type"], "bar")
        self.assertIn("华东", analysis["summary"])
        self.assertIn("1,200", analysis["summary"])

    def test_temporal_result_becomes_line_chart(self):
        analysis = analyze_result(
            [
                {"month": 1, "sales_amount": 100},
                {"month": 2, "sales_amount": 120},
            ]
        )
        self.assertEqual(analysis["chart"]["type"], "line")
        self.assertEqual(analysis["chart"]["label_key"], "month")

    def test_chart_is_limited_to_twelve_rows(self):
        analysis = analyze_result(
            [{"brand": f"品牌{index}", "total_sales": index} for index in range(13)]
        )
        self.assertEqual(len(analysis["chart"]["data"]), 12)
        self.assertTrue(analysis["chart"]["truncated"])

    def test_decimal_and_serialized_numbers_are_chartable(self):
        analysis = analyze_result(
            [
                {"月份": "1月", "销售总额": Decimal("1200.50")},
                {"月份": "2月", "销售总额": "980.25"},
            ]
        )
        self.assertEqual(analysis["chart"]["type"], "line")
        self.assertEqual(analysis["chart"]["value_key"], "销售总额")
        self.assertIn("合计", analysis["summary"])

    def test_node_emits_analysis_event(self):
        events = []
        runtime = SimpleNamespace(stream_writer=events.append)
        result = asyncio.run(
            analyze_result_node(
                {"result": [{"region_name": "华东", "total_sales": 1200}]}, runtime
            )
        )
        self.assertIn("analysis", result)
        self.assertEqual(events[1]["type"], "analysis")


if __name__ == "__main__":
    unittest.main()
