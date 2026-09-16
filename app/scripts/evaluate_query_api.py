"""调用已启动的问数 API 并生成结构化评测报告。

运行示例：
python -m app.scripts.evaluate_query_api --base-url http://127.0.0.1:8000
"""

import argparse
import json
import uuid
from pathlib import Path
from urllib.parse import urlsplit

import httpx

DEFAULT_CASES_PATH = Path("evals/query_cases.json")
DEFAULT_REPORT_PATH = Path("evals/reports/latest.json")
ALLOWED_SCHEMES = ("http", "https")


def validate_base_url(base_url: str) -> str:
    """校验评测目标地址：仅允许 http/https，拒绝携带凭据或缺少主机名的地址。"""

    parts = urlsplit(base_url)
    if parts.scheme not in ALLOWED_SCHEMES:
        raise ValueError(f"评测地址仅允许 http/https 协议，收到 {parts.scheme!r}")
    if parts.username or parts.password:
        raise ValueError("评测地址不允许携带用户名或密码")
    if not parts.hostname:
        raise ValueError("评测地址缺少主机名")
    return base_url.rstrip("/")


def parse_sse_events(body: str) -> list[dict]:
    """解析完整 SSE 响应体中的 JSON data 事件。"""

    events: list[dict] = []
    for chunk in body.split("\n\n"):
        payload = "\n".join(
            line.removeprefix("data:").strip()
            for line in chunk.splitlines()
            if line.startswith("data:")
        )
        if payload:
            events.append(json.loads(payload))
    return events


def login(base_url: str, username: str, password: str, timeout: int) -> str:
    """登录本地演示账号，并返回后续请求使用的 Bearer 令牌。"""

    response = httpx.post(
        f"{base_url}/api/auth/login",
        json={"username": username, "password": password},
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()["access_token"]


def call_query(
    base_url: str, query: str, session_id: str, timeout: int, access_token: str
) -> list[dict]:
    """向 SSE 接口发送一次问数请求，并收集全部事件。"""

    response = httpx.post(
        f"{base_url}/api/query",
        json={"query": query, "session_id": session_id},
        headers={
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {access_token}",
        },
        timeout=timeout,
    )
    response.raise_for_status()
    return parse_sse_events(response.text)


def evaluate_turn(events: list[dict], expected: dict) -> tuple[bool, list[str]]:
    """根据用例期望检查一轮问数的终态、改写问题和最终 SQL。"""

    errors: list[str] = []
    event_types = [event.get("type") for event in events]
    terminal_type = expected["terminal_type"]
    if terminal_type not in event_types:
        errors.append(f"未收到预期终态事件 {terminal_type}，实际为 {event_types}")

    resolved_query = next(
        (event.get("resolved_query", "") for event in events if event.get("type") == "query_context"),
        "",
    )
    for phrase in expected.get("resolved_query_contains", []):
        if phrase not in resolved_query:
            errors.append(f"改写问题未包含 {phrase!r}，实际为 {resolved_query!r}")

    sql = next(
        (event.get("sql", "") for event in reversed(events) if event.get("type") == "sql"),
        "",
    )
    for phrase in expected.get("sql_contains", []):
        if phrase.lower() not in sql.lower():
            errors.append(f"最终 SQL 未包含 {phrase!r}，实际为 {sql!r}")
    return not errors, errors


def evaluate_cases(
    base_url: str,
    cases: list[dict],
    timeout: int,
    access_token: str,
) -> list[dict]:
    """按用例顺序执行多轮会话，并返回每轮可审计结果。"""

    report: list[dict] = []
    for case in cases:
        session_id = str(uuid.uuid4())
        for turn_index, turn in enumerate(case["turns"], start=1):
            events = call_query(base_url, turn["query"], session_id, timeout, access_token)
            passed, errors = evaluate_turn(events, turn["expected"])
            report.append(
                {
                    "case_id": case["id"],
                    "turn": turn_index,
                    "query": turn["query"],
                    "passed": passed,
                    "errors": errors,
                    "events": events,
                }
            )
    return report


def summarize_report(report: list[dict]) -> dict:
    """汇总总通过率，并按用例统计失败轮次，便于版本间对比。"""

    total = len(report)
    passed = sum(item["passed"] for item in report)
    failed_case_ids = sorted({item["case_id"] for item in report if not item["passed"]})
    return {
        "total_turns": total,
        "passed_turns": passed,
        "failed_turns": total - passed,
        "pass_rate": passed / total if total else 0,
        "failed_case_ids": failed_case_ids,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="运行电商问数 API 评测集")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--username", default="admin", help="本地演示账号")
    parser.add_argument("--password", default="admin123", help="本地演示密码")
    args = parser.parse_args()

    try:
        base_url = validate_base_url(args.base_url)
    except ValueError as error:
        parser.error(str(error))
        return

    cases = json.loads(args.cases.read_text(encoding="utf-8"))
    access_token = login(base_url, args.username, args.password, args.timeout)
    report = evaluate_cases(base_url, cases, args.timeout, access_token)
    summary = summarize_report(report)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(
        json.dumps({"summary": summary, "turns": report}, ensure_ascii=False, indent=2)
    )
    print(
        f"评测完成：{summary['passed_turns']}/{summary['total_turns']} 轮通过；"
        f"通过率 {summary['pass_rate']:.1%}；报告：{args.report}"
    )


if __name__ == "__main__":
    main()
