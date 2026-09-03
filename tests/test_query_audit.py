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


if __name__ == "__main__":
    unittest.main()
