"""问数 SQL 的本地安全护栏。

该模块在访问 MySQL 前运行，不依赖模型或数据库。它只允许只读查询，
并为没有显式行数限制的外层查询追加安全上限。
"""

from dataclasses import dataclass

MAX_RESULT_ROWS = 1000

BLOCKED_KEYWORDS = frozenset(
    {
        "ALTER",
        "ANALYZE",
        "BEGIN",
        "CALL",
        "COMMIT",
        "CREATE",
        "DELETE",
        "DROP",
        "EXEC",
        "EXECUTE",
        "GRANT",
        "HANDLER",
        "INSERT",
        "INTO",
        "KILL",
        "LOAD",
        "LOCK",
        "OPTIMIZE",
        "OUTFILE",
        "PREPARE",
        "RENAME",
        "REPLACE",
        "REVOKE",
        "ROLLBACK",
        "SET",
        "SHOW",
        "SOURCE",
        "TRUNCATE",
        "UNLOCK",
        "UPDATE",
        "USE",
    }
)


class SQLSafetyError(ValueError):
    """SQL 违反问数系统只读安全策略时抛出。"""


@dataclass(frozen=True)
class SQLToken:
    """仅保留安全检查需要的关键字和括号层级。"""

    value: str
    depth: int


def _tokenize(sql: str) -> list[SQLToken]:
    """提取非字符串字面量中的单词，并记录括号嵌套层级。"""

    tokens: list[SQLToken] = []
    current: list[str] = []
    depth = 0
    quote: str | None = None
    index = 0

    def flush_word() -> None:
        if current:
            tokens.append(SQLToken("".join(current).upper(), depth))
            current.clear()

    while index < len(sql):
        char = sql[index]
        if quote:
            if char == "\\" and index + 1 < len(sql):
                index += 2
                continue
            if char == quote:
                quote = None
            index += 1
            continue
        if char in {"'", '"', "`"}:
            flush_word()
            quote = char
        elif char == "(":
            flush_word()
            depth += 1
        elif char == ")":
            flush_word()
            depth -= 1
            if depth < 0:
                raise SQLSafetyError("SQL 括号不匹配，已拒绝执行。")
        elif char.isalnum() or char == "_":
            current.append(char)
        else:
            flush_word()
        index += 1

    flush_word()
    if quote or depth != 0:
        raise SQLSafetyError("SQL 字符串或括号不完整，已拒绝执行。")
    return tokens


def guard_sql(sql: str, max_rows: int = MAX_RESULT_ROWS) -> str:
    """校验只读 SQL，并在外层查询没有 LIMIT 时追加结果上限。"""

    normalized = sql.strip()
    if not normalized:
        raise SQLSafetyError("未生成有效 SQL，已拒绝执行。")
    if "--" in normalized or "/*" in normalized or "*/" in normalized:
        raise SQLSafetyError("SQL 不允许包含注释，已拒绝执行。")

    if normalized.endswith(";"):
        normalized = normalized[:-1].rstrip()
    if ";" in normalized:
        raise SQLSafetyError("仅允许执行单条 SQL 查询。")

    tokens = _tokenize(normalized)
    if not tokens or tokens[0].value not in {"SELECT", "WITH"}:
        raise SQLSafetyError("仅允许执行 SELECT 或 WITH ... SELECT 查询。")

    blocked = next((token.value for token in tokens if token.value in BLOCKED_KEYWORDS), None)
    if blocked:
        raise SQLSafetyError(f"检测到不允许的关键字 {blocked}，已拒绝执行。")

    top_level_words = [token.value for token in tokens if token.depth == 0]
    if tokens[0].value == "WITH" and "SELECT" not in top_level_words:
        raise SQLSafetyError("WITH 查询必须以外层 SELECT 结束。")

    if "LIMIT" not in top_level_words:
        normalized = f"{normalized} LIMIT {max_rows}"
    return normalized
