"""问数审计服务的离线测试。"""

import unittest

from app.audit.service import QueryAuditService


class QueryAuditServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = QueryAuditService()

    def test_successful_query_records_trace_without_result_rows(self):
        record = self.service.start("admin", "session-1", "统计华东销售额")
        self.service.observe(
            record,
            {
                "type": "query_context",
                "resolved_query": "统计华东地区销售额",
            },
        )
        self.service.observe(record, {"type": "sql", "sql": "SELECT 1 LIMIT 1000"})
        self.service.observe(record, {"type": "result", "data": [{"销售额": 100}]})
        self.service.finish(record)

        audit = self.service.list_for_user("admin")[0]
        self.assertEqual(audit["status"], "succeeded")
        self.assertEqual(audit["result_row_count"], 1)
        self.assertEqual(audit["resolved_query"], "统计华东地区销售额")
        self.assertNotIn("data", audit)
        self.assertGreaterEqual(audit["duration_ms"], 0)

    def test_audit_records_are_isolated_by_user_and_errors_are_retained(self):
        admin_record = self.service.start("admin", "session-1", "管理员问题")
        self.service.observe(admin_record, {"type": "assistant_message"})
        self.service.finish(admin_record)

        analyst_record = self.service.start("analyst", "session-2", "分析员问题")
        self.service.observe(analyst_record, {"type": "error", "message": "无权查询"})
        self.service.finish(analyst_record)

        self.assertEqual([item["query"] for item in self.service.list_for_user("admin")], ["管理员问题"])
        analyst_audit = self.service.list_for_user("analyst")[0]
        self.assertEqual(analyst_audit["status"], "failed")
        self.assertEqual(analyst_audit["error"], "无权查询")

    def test_unfinished_record_is_marked_failed(self):
        record = self.service.start("admin", "session-1", "中断请求")
        self.service.finish(record)
        audit = self.service.list_for_user("admin")[0]
        self.assertEqual(audit["status"], "failed")
        self.assertEqual(audit["error"], "请求未完成或连接已中断。")

    def test_only_owner_can_submit_feedback_for_completed_audit(self):
        record = self.service.start("analyst", "session-1", "按大区统计销售额")
        self.service.observe(record, {"type": "result", "data": []})
        self.service.finish(record)

        self.assertIsNone(
            self.service.submit_feedback(record.id, "admin", "up", "跨用户提交")
        )
        updated = self.service.submit_feedback(record.id, "analyst", "down", "口径不正确")
        self.assertIsNotNone(updated)
        self.assertEqual(updated["feedback_score"], "down")
        self.assertEqual(updated["feedback_comment"], "口径不正确")


class QualityMetricsTests(unittest.TestCase):
    def setUp(self):
        self.service = QueryAuditService()

    def test_summary_reports_percentiles_and_failure_breakdown(self):
        # 三次成功，耗时 100/200/300ms；一次 SQL 失败、一次业务拒答
        for i, ms in enumerate((100, 200, 300), start=1):
            record = self.service.start("admin", f"s{i}", "统计销售额")
            self.service.observe(record, {"type": "result", "data": []})
            self.service.finish(record)
            record.duration_ms = ms  # finish 后覆写，模拟固定耗时
        failed = self.service.start("admin", "sf", "删除数据")
        self.service.observe(failed, {"type": "error", "code": "query_failed", "message": "x"})
        self.service.finish(failed)
        refused = self.service.start("admin", "sr", "你是谁")
        self.service.observe(refused, {"type": "assistant_message", "message": "我是数分助手"})
        self.service.finish(refused)

        summary = self.service.quality_summary()
        self.assertEqual(summary["total_queries"], 5)
        self.assertEqual(summary["completed_queries"], 5)
        self.assertAlmostEqual(summary["success_rate"], 3 / 5)
        self.assertEqual(summary["p50_duration_ms"], 200)
        self.assertEqual(summary["p95_duration_ms"], 300)
        self.assertEqual(
            summary["failure_breakdown"],
            {"query_failed": 1, "assistant_message": 1},
        )

    def test_summary_counts_empty_history(self):
        summary = self.service.quality_summary()
        self.assertEqual(summary["total_queries"], 0)
        self.assertEqual(summary["p50_duration_ms"], 0)
        self.assertEqual(summary["failure_breakdown"], {})

    def test_step_timings_are_recorded_from_progress_events(self):
        record = self.service.start("admin", "st", "统计销售额")
        self.service.observe(
            record, {"type": "progress", "step": "生成SQL", "status": "running", "ts": 1000.0}
        )
        self.service.observe(
            record, {"type": "progress", "step": "生成SQL", "status": "success", "ts": 1250.0}
        )
        self.service.observe(record, {"type": "result", "data": []})
        self.service.finish(record)

        audit = self.service.list_for_user("admin")[0]
        self.assertEqual(audit["step_timings"], {"生成SQL": 250.0})


if __name__ == "__main__":
    unittest.main()
