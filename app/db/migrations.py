"""
SQLite 应用状态库的版本化迁移

schema_migrations 表记录已应用版本；迁移按版本号顺序执行，重复执行幂等。
旧版本库中已存在同名表时，迁移脚本用 IF NOT EXISTS 兼容并保留数据。
新增结构变更时在 MIGRATIONS 末尾追加 (版本号, 脚本)，不要修改历史迁移。
"""

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

# v1：应用状态库的初始结构（chat_sessions / query_audit_log / analysis_projects）
MIGRATION_V1 = """
CREATE TABLE IF NOT EXISTS chat_sessions (
    username TEXT NOT NULL,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, session_id)
);
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
);
CREATE INDEX IF NOT EXISTS idx_audit_user_started
    ON query_audit_log (username, started_at DESC);
CREATE TABLE IF NOT EXISTS analysis_projects (
    username TEXT NOT NULL,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    project_json TEXT NOT NULL,
    PRIMARY KEY (username, project_id)
);
CREATE INDEX IF NOT EXISTS idx_analysis_projects_user_updated
    ON analysis_projects (username, updated_at DESC);
"""

MIGRATIONS: list[tuple[int, str]] = [
    (1, MIGRATION_V1),
]

LATEST_VERSION = MIGRATIONS[-1][0] if MIGRATIONS else 0


def apply_migrations(database_path: Path) -> int:
    """把数据库迁移到最新版本；返回本次实际执行的迁移条数。"""

    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )
                """
            )
        applied = {
            row["version"]
            for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
        }
        count = 0
        for version, script in MIGRATIONS:
            if version in applied:
                continue
            # executescript 会隐式提交，脚本本身用 IF NOT EXISTS 保证可重入
            connection.executescript(script)
            with connection:
                connection.execute(
                    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
                    (version, datetime.now(UTC).isoformat()),
                )
            count += 1
        return count
    finally:
        connection.close()
