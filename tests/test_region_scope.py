"""P2-C 行列权限升级测试：AST 字段标识匹配与地区作用域自动注入。"""

import unittest

from app.agent.sql_guardrail import SQLSafetyError
from app.auth.policy import enforce_data_policy
from app.auth.service import UserIdentity


def manager(*regions):
    return UserIdentity("east_manager", "华东区域经理", "regional_manager", regions, ("customer_name",))


ANALYST = UserIdentity("analyst", "经营分析员", "analyst", (), ("customer_name",))
ADMIN = UserIdentity("admin", "管理员", "admin", (), ())


class RegionScopeInjectionTests(unittest.TestCase):
    def test_query_without_filter_is_autoscoped(self):
        sql = "SELECT r.region_name, SUM(f.payment_amount) FROM fact_order f JOIN dim_region r ON f.region_id = r.region_id GROUP BY r.region_name"
        scoped = enforce_data_policy(sql, manager("华东"))
        self.assertIn("IN", scoped.upper())
        self.assertIn("华东", scoped)

    def test_conflicting_filter_is_overridden_to_allowed_region(self):
        sql = "SELECT region_name FROM dim_region WHERE region_name = '华北'"
        scoped = enforce_data_policy(sql, manager("华东"))
        # 输出被包装为只含华东；用户给的华北条件不再决定可见范围
        self.assertIn("华东", scoped)

    def test_multiple_regions_use_in(self):
        sql = "SELECT region_name FROM dim_region"
        scoped = enforce_data_policy(sql, manager("华东", "华北"))
        self.assertIn("华东", scoped)
        self.assertIn("华北", scoped)

    def test_cte_query_is_scoped(self):
        sql = (
            "WITH totals AS (SELECT r.region_name AS name, SUM(f.payment_amount) AS total "
            "FROM fact_order f JOIN dim_region r ON f.region_id = r.region_id GROUP BY name) "
            "SELECT name, total FROM totals"
        )
        scoped = enforce_data_policy(sql, manager("华东"))
        self.assertIn("华东", scoped)

    def test_missing_region_output_still_scoped(self):
        """结果不含地区列也照常注入过滤（不再依赖模型输出地区列）。"""

        scoped = enforce_data_policy("SELECT region_id FROM dim_region", manager("华东"))
        self.assertIn("华东", scoped)
        self.assertIn("IN", scoped.upper())

    def test_alias_is_respected_in_injection(self):
        scoped = enforce_data_policy(
            "SELECT r.region_name FROM dim_region r", manager("华东")
        )
        self.assertIn("华东", scoped)
        # 注入条件应携带表别名前缀，避免多表列名歧义
        self.assertRegex(scoped.replace("`", ""), r"r\.region_name\s+IN")

    def test_existing_user_filter_combined_not_replaced(self):
        """注入与用户条件以 AND 组合；授权范围始终生效。"""

        scoped = enforce_data_policy(
            "SELECT region_name FROM dim_region WHERE region_name = '华北'",
            manager("华东"),
        )
        upper = scoped.upper()
        self.assertIn("华北", scoped)  # 用户条件保留
        self.assertIn("华东", scoped)  # 授权注入生效
        self.assertIn(" AND ", upper)

    def test_query_without_dim_region_rejected(self):
        with self.assertRaises(SQLSafetyError):
            enforce_data_policy("SELECT * FROM fact_order", manager("华东"))

    def test_admin_is_not_wrapped(self):
        sql = "SELECT region_name FROM dim_region"
        self.assertEqual(enforce_data_policy(sql, ADMIN), sql)


class ColumnIdentifierPolicyTests(unittest.TestCase):
    def test_masked_column_rejected_by_identifier(self):
        with self.assertRaisesRegex(SQLSafetyError, "customer_name"):
            enforce_data_policy("SELECT customer_name FROM dim_customer", ANALYST)

    def test_masked_column_with_table_alias_rejected(self):
        with self.assertRaisesRegex(SQLSafetyError, "customer_name"):
            enforce_data_policy("SELECT c.customer_name FROM dim_customer c", ANALYST)

    def test_literal_mentioning_field_name_no_longer_false_positive(self):
        sql = "SELECT 'customer_name 是敏感列' AS note FROM fact_order"
        self.assertEqual(enforce_data_policy(sql, ANALYST), sql)

    def test_wildcard_on_customer_dim_rejected(self):
        with self.assertRaisesRegex(SQLSafetyError, "通配符"):
            enforce_data_policy("SELECT * FROM dim_customer", ANALYST)

    def test_wildcard_on_other_tables_allowed(self):
        sql = "SELECT * FROM fact_order"
        self.assertEqual(enforce_data_policy(sql, ANALYST), sql)


if __name__ == "__main__":
    unittest.main()
