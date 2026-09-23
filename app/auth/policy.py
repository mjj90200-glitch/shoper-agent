"""SQL 数据范围校验与结果脱敏。

P2-C 起基于 sqlglot 语法树实现两层策略：
- 列权限：按字段标识（列名）匹配敏感字段，替代展示名子串匹配；
- 行权限：为区域经理自动注入地区作用域——把 `region_name IN (授权地区)`
  注入每个引用 dim_region 的 SELECT 层，多地区、CTE、别名和子查询天然支持，
  且不依赖模型是否在输出中携带地区列。

`mask_sensitive_rows` 查询后脱敏层保持不变，形成纵深防御。
"""

import sqlglot
from sqlglot import exp

from app.agent.sql_guardrail import SQLSafetyError
from app.auth.service import UserIdentity

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


def _inject_region_scope(sql: str, user: UserIdentity) -> str:
    """把 `region_name IN (授权地区)` 直接注入每个引用 dim_region 的查询层。

    相比外层包装，WHERE 注入不依赖模型是否输出地区列，行为完全确定；
    别名、CTE 与子查询场景下各 SELECT 层都会被独立注入。
    """

    tree = _parse(sql)

    region_tables = [
        table for table in tree.find_all(exp.Table)
        if table.name.lower() == "dim_region"
    ]
    if not region_tables:
        raise SQLSafetyError("区域经理查询必须关联地区维度，已拒绝执行。")

    allowed_values = [exp.Literal.string(region) for region in user.allowed_regions]
    for table in region_tables:
        owning_select = table.find_ancestor(exp.Select)
        if owning_select is None:
            continue
        condition = exp.In(
            this=exp.column(SCOPE_COLUMN, table=table.alias_or_name),
            expressions=allowed_values,
        )
        # sqlglot 的 where() 是返回副本的构建器；这里原地 set 以保留整棵树
        existing = owning_select.args.get("where")
        if existing is not None:
            combined = exp.And(this=existing.this, expression=condition)
            owning_select.set("where", exp.Where(this=combined))
        else:
            owning_select.set("where", exp.Where(this=condition))
    return tree.sql(dialect="mysql")


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
