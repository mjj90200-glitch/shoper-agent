"""SQL 数据范围校验与结果脱敏。"""

import re

from app.agent.sql_guardrail import SQLSafetyError
from app.auth.service import UserIdentity


def enforce_data_policy(sql: str, user: UserIdentity) -> str:
    """对已通过只读检查的 SQL 追加演示版数据权限限制。"""

    normalized = sql.lower()
    for field in user.masked_fields:
        if field.lower() in normalized:
            raise SQLSafetyError(f"当前角色无权查询敏感字段 {field}。")
    if user.masked_fields and "dim_customer" in normalized and re.search(
        r"\bselect\s+(?:distinct\s+)?(?:\w+\.)?\*", normalized
    ):
        raise SQLSafetyError("当前角色不能通过通配符查询客户维度。")

    if not user.allowed_regions:
        return sql
    if "dim_region" not in normalized or "region_name" not in normalized:
        raise SQLSafetyError("区域经理查询必须关联地区维度并包含地区筛选条件。")
    if " union " in normalized or " or " in normalized:
        raise SQLSafetyError("区域权限查询不允许使用 UNION 或 OR 条件。")
    if not any(
        re.search(
            rf"\b(?:\w+\.)?region_name\s*=\s*'{re.escape(region.lower())}'",
            normalized,
        )
        for region in user.allowed_regions
    ):
        raise SQLSafetyError(
            f"当前角色仅允许查询地区：{'、'.join(user.allowed_regions)}。"
        )
    return sql


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
