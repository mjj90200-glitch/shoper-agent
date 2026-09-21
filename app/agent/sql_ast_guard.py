"""基于 sqlglot 语法树的 SQL 只读安全校验。

这是 SQL 安全的第一道防线：先解析语法树再做结构性判断，比关键词扫描
更难被注释、编码或大小写手法绕过。app/agent/sql_guardrail.py 的关键词
扫描保留为第二道纵深防御，两者都通过后才会进入数据库侧的只读账号。

策略要点：
- 仅允许单条 SELECT（含 WITH ... SELECT）语句；
- 表引用只允许数仓库 `dw`（不带库前缀的表视为默认库），系统库一律拒绝；
- 拒绝写操作、存储过程调用、文件读写、系统变量和用户变量；
- 限制 JOIN 数量与子查询嵌套深度；
- 外层 LIMIT 超过上限时收敛到上限，缺失时补上限。
"""

import sqlglot
from sqlglot import exp

from app.agent.sql_guardrail import SQLSafetyError

MAX_JOINS = 6
MAX_SUBQUERY_DEPTH = 4

ALLOWED_DATABASES = frozenset({"dw"})
SYSTEM_DATABASES = frozenset({"mysql", "information_schema", "performance_schema", "sys"})
BLOCKED_FUNCTIONS = frozenset({"LOAD_FILE"})


def _iter_subqueries(root: exp.Expression) -> list[exp.Expression]:
    """收集语句中的全部子查询节点（含 CTE 主体），用于深度检查。"""

    return list(root.find_all(exp.Subquery, exp.CTE))


def _check_table_references(root: exp.Expression) -> None:
    for table in root.find_all(exp.Table):
        database = (table.db or "").lower()
        name = (table.name or "").lower()
        if database in SYSTEM_DATABASES or name in SYSTEM_DATABASES:
            raise SQLSafetyError("不允许访问系统库表，已拒绝执行。")
        if database and database not in ALLOWED_DATABASES:
            raise SQLSafetyError("只允许查询电商数仓（dw）中的表，已拒绝执行。")


def _check_functions(root: exp.Expression) -> None:
    for function in root.find_all(exp.Func):
        names = {function.sql_name().upper()}
        # LOAD_FILE 等未建模函数会解析为 Anonymous，真实函数名在 this 上
        anonymous_name = function.this if isinstance(function, exp.Anonymous) else None
        if isinstance(anonymous_name, str):
            names.add(anonymous_name.upper())
        if names & BLOCKED_FUNCTIONS:
            raise SQLSafetyError("检测到不允许使用的函数，已拒绝执行。")


def _check_file_and_variable_access(root: exp.Expression) -> None:
    # SELECT ... INTO OUTFILE / DUMPFILE
    if root.find(exp.Into) is not None:
        raise SQLSafetyError("不允许把查询结果写入文件，已拒绝执行。")
    # 命令式语句（SET/SHOW/KILL 等由解析为 Command 的片段承载）
    if root.find(exp.Command) is not None:
        raise SQLSafetyError("检测到不允许的命令语句，已拒绝执行。")
    # 系统变量 @@version、用户变量 @x
    if root.find(exp.SessionParameter) is not None:
        raise SQLSafetyError("不允许访问系统变量，已拒绝执行。")
    if root.find(exp.Parameter) is not None:
        raise SQLSafetyError("不允许使用用户变量，已拒绝执行。")


def validate_sql_ast(sql: str, max_rows: int = 1000) -> str:
    """解析并校验 SQL；返回补齐/收敛 LIMIT 后的安全 SQL，不通过则抛 SQLSafetyError。"""

    normalized = sql.strip()
    if not normalized:
        raise SQLSafetyError("未生成有效 SQL，已拒绝执行。")

    if "--" in normalized or "/*" in normalized or "*/" in normalized:
        raise SQLSafetyError("SQL 不允许包含注释，已拒绝执行。")

    try:
        statements = sqlglot.parse(normalized, dialect="mysql")
    except sqlglot.errors.ParseError as error:
        raise SQLSafetyError("SQL 解析失败，已拒绝执行。") from error

    statements = [statement for statement in statements if statement is not None]
    if len(statements) != 1:
        raise SQLSafetyError("仅允许执行单条 SQL 查询。")
    statement = statements[0]

    # 顶层必须是 SELECT；WITH 会被 sqlglot 解析为带 CTE 的 SELECT
    if not isinstance(statement, exp.Select):
        raise SQLSafetyError("仅允许执行 SELECT 或 WITH ... SELECT 查询。")

    _check_table_references(statement)
    _check_functions(statement)
    _check_file_and_variable_access(statement)

    if len(list(statement.find_all(exp.Join))) > MAX_JOINS:
        raise SQLSafetyError("JOIN 数量超过上限，已拒绝执行。")
    if len(_iter_subqueries(statement)) > MAX_SUBQUERY_DEPTH:
        raise SQLSafetyError("子查询嵌套深度超过上限，已拒绝执行。")

    return _apply_row_limit(statement, max_rows)


def _apply_row_limit(statement: exp.Select, max_rows: int) -> str:
    """外层 LIMIT 缺失时补上限；超出上限时收敛，内层 LIMIT 不受影响。"""

    outer_limit = statement.args.get("limit")
    outer_limit_value = None
    if outer_limit is not None:
        try:
            outer_limit_value = int(outer_limit.expression.this)
        except (AttributeError, TypeError, ValueError):
            outer_limit_value = None

    if outer_limit_value is None:
        statement = statement.limit(max_rows, dialect="mysql")
    elif outer_limit_value > max_rows:
        statement.set("limit", exp.Limit(expression=exp.Literal.number(max_rows)))
    return statement.sql(dialect="mysql")
