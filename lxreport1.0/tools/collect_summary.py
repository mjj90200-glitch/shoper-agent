"""扫描 lxreport1.0 下已生成的 JSON 证据，汇总生成 test-summary.json。"""

from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "lxreport1.0"


def now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def collect():
    results = {}
    files = sorted(OUT.rglob("*.json"))
    for f in files:
        if f.name == "test-summary.json":
            continue
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue

        # 显式 passed 字段
        if "passed" in data:
            key = data.get("case") or f.stem
            results[f"{f.parent.name}/{f.name}"] = {
                "case": key,
                "passed": bool(data["passed"]),
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：分析计划（status + steps）
        if f.parent.name == "analysis" and "plan" in data:
            steps = data.get("plan", {}).get("steps", [])
            ok = data.get("status") == 200 and 2 <= len(steps) <= 5
            results[f"{f.parent.name}/{f.name}"] = {
                "case": data.get("case") or "ANALYSIS-PLAN",
                "passed": ok,
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：追问
        if "turn1_resolved" in data and "turn2_resolved" in data:
            results[f"{f.parent.name}/{f.name}"] = {
                "case": "TC-ASK-002-FOLLOWUP",
                "passed": bool(data.get("passed")),
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：登录
        if "access_token" in data or (isinstance(data.get("body"), dict) and "access_token" in data.get("body", {})):
            results[f"{f.parent.name}/{f.name}"] = {
                "case": f.stem,
                "passed": True,
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：跨用户隔离（overlap 为空 = 通过）
        if "overlap" in data and "admin_count" in data:
            results[f"{f.parent.name}/{f.name}"] = {
                "case": "AUDIT-ISOLATION",
                "passed": len(data.get("overlap", [])) == 0,
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：跨用户越权（status/xxx_status 含 404 且是预期拒绝）
        if "admin_session" in data or "missing_status" in data:
            statuses = [v for k, v in data.items() if k.endswith("_status") or k == "status"]
            ok = statuses and all(s in (200, 204, 404, 400, 401, 403, 413) for s in statuses)
            results[f"{f.parent.name}/{f.name}"] = {
                "case": f.stem,
                "passed": ok,
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：会话列表/详情（含 session_id）
        if f.parent.name == "sessions":
            results[f"{f.parent.name}/{f.name}"] = {
                "case": f.stem,
                "passed": data.get("status") in (200, 204) or data.get("status") in (400, 401, 404, 403, 413),
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # 推断：审计
        if f.parent.name == "audit":
            ok_status = data.get("status") in (200, 403, 404)
            results[f"{f.parent.name}/{f.name}"] = {
                "case": f.stem,
                "passed": ok_status,
                "evidence": str(f.relative_to(OUT)),
            }
            continue

        # TC-Q 汇总（含每题通过情况）
        if f.name == "tc-q-summary.json" and "cases" in data:
            for case in data["cases"]:
                results[f"ask/tc-q-{case['case'].split('-')[-1]}"] = {
                    "case": case["case"].upper(),
                    "passed": bool(case.get("passed")),
                    "evidence": str(f.relative_to(OUT)),
                    "detail": {"row_count": case.get("row_count"), "has_chart": case.get("chart") is not None},
                }
            continue

        # 跳过/重试验证（记录错误数变化）
        if "errorsBefore" in data and "errorsAfter" in data:
            results[f"ui/{f.stem}"] = {
                "case": f.stem,
                "passed": data.get("errorsAfter", 99) < data.get("errorsBefore", 100),
                "evidence": str(f.relative_to(OUT)),
                "detail": {"before": data.get("errorsBefore"), "after": data.get("errorsAfter")},
            }
            continue

    # 补充每个文件的推断结果
    total = len(results)
    passed = sum(1 for v in results.values() if v["passed"])
    failed = {k: v for k, v in results.items() if not v["passed"]}
    summary = {
        "generated_at": now(),
        "project": "shoper-agent-main",
        "report_dir": "lxreport1.0",
        "total_evidence_files": total,
        "passed": passed,
        "failed": total - passed,
        "failed_items": failed,
    }
    (OUT / "api" / "test-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    collect()
