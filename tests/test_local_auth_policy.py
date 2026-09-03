"""本地演示账号和数据权限规则测试。"""

import unittest

from app.agent.sql_guardrail import SQLSafetyError
from app.auth.policy import enforce_data_policy, mask_sensitive_rows
from app.auth.service import UserIdentity, local_auth_service


class LocalAuthPolicyTests(unittest.TestCase):
    def setUp(self):
        self.admin = UserIdentity("admin", "管理员", "admin", (), ())
        self.east_manager = UserIdentity(
            "east_manager",
            "华东区域经理",
            "regional_manager",
            ("华东",),
            ("customer_name",),
        )
        self.analyst = UserIdentity(
            "analyst", "经营分析员", "analyst", (), ("customer_name",)
        )

    def test_configured_demo_account_can_authenticate(self):
        result = local_auth_service.authenticate("admin", "admin123")
        self.assertIsNotNone(result)
        token, user = result or ("", self.admin)
        self.assertEqual(user.username, "admin")
        self.assertEqual(local_auth_service.get_identity(token), user)

    def test_wrong_password_is_rejected(self):
        self.assertIsNone(local_auth_service.authenticate("admin", "wrong-password"))

    def test_region_manager_requires_its_region_filter(self):
        safe_sql = """
            SELECT r.region_name, SUM(f.payment_amount)
            FROM fact_order f JOIN dim_region r ON f.region_id = r.region_id
            WHERE r.region_name = '华东'
            GROUP BY r.region_name
        """
        self.assertIn("华东", enforce_data_policy(safe_sql, self.east_manager))

        with self.assertRaises(SQLSafetyError):
            enforce_data_policy("SELECT * FROM fact_order", self.east_manager)
        with self.assertRaises(SQLSafetyError):
            enforce_data_policy(
                "SELECT * FROM dim_region WHERE region_name = '华北'", self.east_manager
            )

    def test_sensitive_customer_field_is_rejected_and_masked(self):
        with self.assertRaisesRegex(SQLSafetyError, "customer_name"):
            enforce_data_policy("SELECT customer_name FROM dim_customer", self.analyst)
        with self.assertRaisesRegex(SQLSafetyError, "通配符"):
            enforce_data_policy("SELECT * FROM dim_customer", self.analyst)

        self.assertEqual(
            mask_sensitive_rows(
                [{"customer_name": "李伟", "gmv": 100}], self.analyst
            ),
            [{"customer_name": "李**", "gmv": 100}],
        )
        self.assertEqual(
            mask_sensitive_rows([{"customer_name": "李伟"}], self.admin),
            [{"customer_name": "李伟"}],
        )


if __name__ == "__main__":
    unittest.main()
