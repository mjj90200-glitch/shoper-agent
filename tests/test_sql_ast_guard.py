"""SQL AST 安全校验测试。

基于 sqlglot 的语法树校验是只读策略的第一道防线；自定义关键词扫描保留为纵深防御。
"""

import unittest

from app.agent.sql_ast_guard import validate_sql_ast
from app.agent.sql_guardrail import SQLSafetyError


class SqlAstGuardAcceptTests(unittest.TestCase):
    def test_simple_select_passes_and_appends_limit(self):
        sql = validate_sql_ast("SELECT region_name FROM dim_region")
        self.assertTrue(sql.upper().endswith("LIMIT 1000"))

    def test_cte_select_passes(self):
        sql = validate_sql_ast(
            "WITH totals AS (SELECT region_id, SUM(sales_amount) AS total "
            "FROM fact_order GROUP BY region_id) "
            "SELECT r.region_name, t.total FROM totals t JOIN dim_region r "
            "ON r.region_id = t.region_id LIMIT 100"
        )
        self.assertTrue(sql.upper().endswith("LIMIT 100"))

    def test_where_and_aggregation_pass(self):
        validate_sql_ast(
            "SELECT COUNT(*) FROM fact_order WHERE order_date BETWEEN '2025-01-01' AND '2025-12-31'"
        )

    def test_existing_limit_within_cap_is_kept(self):
        sql = validate_sql_ast("SELECT region_name FROM dim_region LIMIT 20")
        self.assertTrue(sql.upper().endswith("LIMIT 20"))


class SqlAstGuardRejectTests(unittest.TestCase):
    def assert_rejected(self, sql: str):
        with self.assertRaises(SQLSafetyError):
            validate_sql_ast(sql)

    def test_empty_sql_rejected(self):
        self.assert_rejected("   ")

    def test_write_statements_rejected(self):
        for sql in (
            "INSERT INTO fact_order VALUES (1)",
            "UPDATE fact_order SET sales_amount = 0",
            "DELETE FROM fact_order",
            "CREATE TABLE evil (id INT)",
            "DROP TABLE fact_order",
            "TRUNCATE TABLE fact_order",
            "ALTER TABLE fact_order ADD COLUMN x INT",
            "GRANT ALL ON dw.* TO 'u'@'%'",
        ):
            with self.subTest(sql=sql):
                self.assert_rejected(sql)

    def test_multi_statement_rejected(self):
        self.assert_rejected("SELECT 1; SELECT 2")

    def test_comment_rejected(self):
        self.assert_rejected("SELECT 1 -- tail comment")
        self.assert_rejected("/* block */ SELECT 1")

    def test_unparseable_sql_rejected(self):
        self.assert_rejected("SELCT FROM WHERE")

    def test_select_into_outfile_rejected(self):
        self.assert_rejected("SELECT region_name FROM dim_region INTO OUTFILE '/tmp/x'")

    def test_system_database_rejected(self):
        for sql in (
            "SELECT user FROM mysql.user",
            "SELECT table_name FROM information_schema.tables",
            "SELECT * FROM performance_schema.events",
            "SELECT * FROM sys.config",
        ):
            with self.subTest(sql=sql):
                self.assert_rejected(sql)

    def test_load_file_function_rejected(self):
        self.assert_rejected("SELECT LOAD_FILE('/etc/passwd')")

    def test_session_variable_rejected(self):
        self.assert_rejected("SELECT @@version")
        self.assert_rejected("SET @x = 1; SELECT @x")

    def test_stored_procedure_call_rejected(self):
        self.assert_rejected("CALL some_procedure()")

    def test_join_limit_enforced(self):
        tables = " JOIN dim_region r1 ON r1.region_id = f.region_id".join(
            ["FROM fact_order f"] * 7
        )
        self.assert_rejected(f"SELECT r1.region_name FROM {tables.lstrip('FROM ')}")

    def test_subquery_depth_enforced(self):
        nested = "SELECT 1"
        for _ in range(6):
            nested = f"SELECT * FROM ({nested}) AS sub"
        self.assert_rejected(nested)


class SqlAstGuardLimitTests(unittest.TestCase):
    def test_outer_limit_above_cap_is_clamped(self):
        sql = validate_sql_ast("SELECT region_name FROM dim_region LIMIT 99999")
        self.assertTrue(sql.upper().endswith("LIMIT 1000"))

    def test_inner_limit_is_not_touched(self):
        sql = validate_sql_ast(
            "SELECT region_name FROM (SELECT region_name FROM dim_region LIMIT 5) AS t"
        )
        self.assertIn("LIMIT 5", sql.upper())


if __name__ == "__main__":
    unittest.main()
