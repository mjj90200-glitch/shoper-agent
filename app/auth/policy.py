"""SQL 数据范围校验与结果脱敏。

P2-C 起基于 sqlglot 语法树实现两层策略：
- 列权限：按字段标识（列名）匹配敏感字段，替代展示名子串匹配；
- 行权限：为区域经理自动注入地区作用域——把原查询包装为子查询，
  在外层追加 `region_name IN (授权地区)`，多地区、CTE 和别名场景天然支持。

`mask_sensitive_rows` 查询后脱敏层保持不变，形成纵深防御。
"""

import sqlglot
from sqlglot import exp

from app.agent.sql_guardrail import SQLSafetyError
from app.auth.service import UserIdentity

SCOPE_WRAPPER_ALIAS = "__region_scope"
SCOPE_COLUMN = "region_name"


def _parse(sql: str) -> exp.Expression:
    try:
        statements = sqlglot.parse(sql.strip(), dialect="mysql")
    except sqlglot.errors.ParseError as error:
        raise SQLSafetyError("SQL 解析失败，已拒绝执行。") from error
    statements = [statement for statement in statements if statement is not None]
    if len(statements) != 1 or not isinstance(statements[0], exp.Select):
        raise SQLSafetyError("仅允许执行单条 SELECT 查询。")
    return statements[0]


def _reject_masked_columns(sql: str, user: UserIdentity) -> None:
    """按字段标识检查敏感列；展示名出现在字符串字面量中不再误伤。"""

    if not user.masked_fields:
        return
    masked = {field.lower() for field in user.masked_fields}
    tree = _parse(sql)
    for column in tree.find_all(exp.Column):
        if column.name.lower() in masked:
            raise SQLSafetyError(f"当前角色无权查询敏感字段 {column.name}。")

    # 通配符不能越过列权限：涉及客户维度时禁止 SELECT *
    tables = {table.name.lower() for table in tree.find_all(exp.Table)}
    if "dim_customer" in tables and tree.find_all(exp.Star):
        raise SQLSafetyError("当前角色不能通过通配符查询客户维度。")


def _collect_region_derived_names(tree: exp.Expression) -> set[str]:
    """收集整棵语法树中所有由 region_name 列（含改名）产生的输出名。"""

    names: set[str] = set()
    for select in tree.find_all(exp.Select):
        for projection in select.expressions:
            if isinstance(projection, exp.Alias):
                inner, output_name = projection.this, projection.alias.lower()
            else:
                inner, output_name = projection, projection.output_name.lower()
            if isinstance(inner, exp.Column) and inner.name.lower() == SCOPE_COLUMN:
                names.add(output_name)
    return names


def _find_scope_output_name(tree: exp.Select, derived: set[str]) -> str | None:
    """在外层输出中找到指向地区取值的列名。"""

    for projection in tree.expressions:
        output_name = projection.output_name.lower()
        if output_name in derived:
            return output_name
    return None


def _inject_region_scope(sql: str, user: UserIdentity) -> str:
    """把查询包装为子查询并在外层注入地区白名单；无输出地区列则拒绝。"""

    tree = _parse(sql)

    referenced = any(table.name.lower() == "dim_region" for table in tree.find_all(exp.Table))
    if not referenced:
        raise SQLSafetyError("区域经理查询必须关联地区维度，已拒绝执行。")

    # 输出列必须能提供地区取值（允许 CTE/改名引用），外层包装才能完成过滤
    derived = _collect_region_derived_names(tree)
    scope_output = _find_scope_output_name(tree, derived)
    if scope_output is None:
        raise SQLSafetyError(
            "区域经理查询必须在结果中包含 region_name 列，已拒绝执行。"
        )

    allowed_values = [exp.Literal.string(region) for region in user.allowed_regions]
    scope_condition = exp.In(
        this=exp.column(scope_output, table=SCOPE_WRAPPER_ALIAS),
        expressions=allowed_values,
    )
    wrapped = (
        exp.select("*")
        .from_(tree.subquery(alias=SCOPE_WRAPPER_ALIAS))
        .where(scope_condition)
        .limit(1000)
    )
    return wrapped.sql(dialect="mysql")


def enforce_data_policy(sql: str, user: UserIdentity) -> str:
    """对已通过只读检查的 SQL 执行列权限与地区作用域注入。"""

    _reject_masked_columns(sql, user)

    if not user.allowed_regions:
        return sql
    return _inject_region_scope(sql, user)


def mask_sensitive_rows(rows: list[dict], user: UserIdentity) -> list[dict]:
    """对返回结果二次脱敏，避免上游列别名或 SQL 漏网造成泄露。"""

    if not user.masked_fields:
        return rows
    masked_rows: list[dict] = []
    for row in rows:
        masked_row = dict(row)
        for field in user.masked_fields:
            if field in masked_row and masked_row[field] is not None:
                value = str(masked_row[field])
                masked_row[field] = f"{value[:1]}**" if value else "**"
        masked_rows.append(masked_row)
    return masked_rows
