"""基于真实查询结果生成确定性摘要与轻量图表规格。"""

from decimal import Decimal, InvalidOperation
from typing import Literal, TypedDict


class ChartPoint(TypedDict):
    label: str
    value: float


class ChartSpec(TypedDict):
    type: Literal["bar", "line"]
    label_key: str
    value_key: str
    data: list[ChartPoint]
    truncated: bool


class ResultAnalysis(TypedDict):
    summary: str
    chart: ChartSpec | None


MAX_CHART_POINTS = 12
VALUE_KEYWORDS = (
    "sales", "amount", "gmv", "quantity", "count", "total", "sum", "revenue",
    "销售", "金额", "成交额", "销量", "数量", "订单", "总额", "均价", "利润",
)
TIME_KEYWORDS = (
    "date", "time", "year", "quarter", "month", "week", "day",
    "日期", "时间", "年", "季度", "月", "周", "日",
)


def _to_number(value: object) -> float | None:
    """兼容数据库 Decimal 和经 SSE 序列化后的数字字符串。"""

    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float | Decimal):
        return float(value)
    if isinstance(value, str):
        normalized = value.strip().replace(",", "").removesuffix("%")
        if not normalized:
            return None
        try:
            return float(Decimal(normalized))
        except InvalidOperation:
            return None
    return None


def _format_number(value: float) -> str:
    formatted = f"{value:,.2f}"
    return formatted.rstrip("0").rstrip(".")


def _pick_value_key(rows: list[dict]) -> str | None:
    numeric_keys = [
        key for key in rows[0] if all(_to_number(row.get(key)) is not None for row in rows)
    ]
    if not numeric_keys:
        return None
    return next(
        (
            key
            for key in numeric_keys
            if any(keyword in key.lower() for keyword in VALUE_KEYWORDS)
        ),
        numeric_keys[0],
    )


def _pick_label_key(rows: list[dict], value_key: str) -> str | None:
    label_keys = [
        key
        for key in rows[0]
        if key != value_key and any(row.get(key) is not None for row in rows)
    ]
    if not label_keys:
        return None
    return next(
        (
            key
            for key in label_keys
            if any(keyword in key.lower() for keyword in TIME_KEYWORDS)
        ),
        label_keys[0],
    )


def analyze_result(rows: list[dict]) -> ResultAnalysis:
    """根据真实结果构造摘要；无法可靠映射时只返回行数，不臆造结论。"""

    if not rows:
        return {"summary": "查询完成，结果为空。", "chart": None}

    value_key = _pick_value_key(rows)
    if value_key is None:
        return {"summary": f"查询完成，共 {len(rows)} 行结果。", "chart": None}

    label_key = _pick_label_key(rows, value_key)
    values = [_to_number(row[value_key]) for row in rows]
    numeric_values = [value for value in values if value is not None]
    if not numeric_values:
        return {"summary": f"查询完成，共 {len(rows)} 行结果。", "chart": None}
    values = numeric_values
    max_index = max(range(len(values)), key=values.__getitem__)
    min_index = min(range(len(values)), key=values.__getitem__)

    if label_key:
        max_label = str(rows[max_index][label_key])
        min_label = str(rows[min_index][label_key])
        total = sum(values)
        average = total / len(values)
        summary = (
            f"共 {len(rows)} 个数据点；{value_key} 合计 {_format_number(total)}，"
            f"平均 {_format_number(average)}。最高为 {max_label}（{_format_number(values[max_index])}），"
            f"最低为 {min_label}（{_format_number(values[min_index])}）。"
        )
    else:
        summary = (
            f"共 {len(rows)} 行；{value_key} 最大值为 {_format_number(values[max_index])}，"
            f"最小值为 {_format_number(values[min_index])}。"
        )

    if label_key is None:
        return {"summary": summary, "chart": None}

    chart_type: Literal["bar", "line"] = (
        "line"
        if any(keyword in label_key.lower() for keyword in TIME_KEYWORDS)
        else "bar"
    )
    chart_data = [
        {"label": str(row[label_key]), "value": _to_number(row[value_key]) or 0.0}
        for row in rows[:MAX_CHART_POINTS]
    ]
    return {
        "summary": summary,
        "chart": {
            "type": chart_type,
            "label_key": label_key,
            "value_key": value_key,
            "data": chart_data,
            "truncated": len(rows) > MAX_CHART_POINTS,
        },
    }
