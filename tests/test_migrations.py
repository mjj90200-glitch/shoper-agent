"""SQLite 应用状态库迁移机制测试。

验收：空库可迁移到最新版本、已有旧库升级保留数据、重复执行幂等。
全部使用临时目录，不操作开发者本地数据。
"""

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from app.db.migrations import LATEST_VERSION, apply_migrations


def table_names(database_path: Path) -> set[str]:
    with closing(sqlite3.connect(database_path)) as connection:
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    return {row[0] for row in rows}


class ApplyMigrationsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = Path(self._tmp.name) / "state.sqlite"

    def test_empty_database_reaches_latest_version(self):
        applied = apply_migrations(self.db_path)
        self.assertEqual(applied, LATEST_VERSION)
        names = table_names(self.db_path)
        for required in (
            "schema_migrations",
            "chat_sessions",
            "query_audit_log",
            "analysis_projects",
        ):
            self.assertIn(required, names)

    def test_reapply_is_idempotent(self):
        apply_migrations(self.db_path)
        applied_again = apply_migrations(self.db_path)
        self.assertEqual(applied_again, 0)

    def test_legacy_tables_upgrade_preserves_data(self):
        # 模拟旧库：旧代码直接 CREATE TABLE IF NOT EXISTS，然后已写入一条审计
        with closing(sqlite3.connect(self.db_path)) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS query_audit_log (
                    id TEXT PRIMARY KEY,
                    username TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    query TEXT NOT NULL,
                    resolved_query TEXT,
                    sql_text TEXT,
                    result_row_count INTEGER,
                    terminal_type TEXT,
                    status TEXT NOT NULL,
                    error TEXT,
                    feedback_score TEXT,
                    feedback_comment TEXT,
                    feedback_at TEXT,
                    started_at TEXT NOT NULL,
                    duration_ms INTEGER
                )
                """
            )
            connection.execute(
                "INSERT INTO query_audit_log VALUES ('a1', 'admin', 's1', 'q', NULL, NULL, NULL, 'result', 'succeeded', NULL, NULL, NULL, NULL, '2026-09-16T00:00:00+00:00', 100)"
            )
            connection.commit()

        applied = apply_migrations(self.db_path)
        self.assertEqual(applied, LATEST_VERSION)

        with closing(sqlite3.connect(self.db_path)) as connection:
            row = connection.execute(
                "SELECT id, status FROM query_audit_log WHERE id='a1'"
            ).fetchone()
        self.assertEqual(row, ("a1", "succeeded"))

    def test_creates_parent_directory(self):
        nested = self.db_path.parent / "level2" / "state.sqlite"
        applied = apply_migrations(nested)
        self.assertEqual(applied, LATEST_VERSION)
        self.assertTrue(nested.exists())


if __name__ == "__main__":
    unittest.main()
