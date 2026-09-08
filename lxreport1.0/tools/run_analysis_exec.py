"""执行 TC-ANALYSIS-001 完整闭环：逐步骤执行计划查询，保存证据。"""

from __future__ import annotations

import importlib.util
import json
import time
import uuid

spec = importlib.util.spec_from_file_location("api_tests", "lxreport1.0/tools/api_tests.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def main():
    status, body = api.login("admin", "admin123")
    token = body["access_token"]
    plan_data = json.load(open("lxreport1.0/functional/analysis/tc-analysis-001-plan-clean.json", encoding="utf-8"))
    steps = plan_data["plan"]["steps"]
    pid = json.load(open("lxreport1.0/functional/analysis/tc-analysis-001-save-clean.json", encoding="utf-8"))["pid"]

    results = []
    for i, step in enumerate(steps):
        sid = str(uuid.uuid4())
        t0 = time.time()
        payload = api.sse_query(token, step["question"], sid, f"tc-analysis-001-exec-step{i+1}")
        dt = round(time.time() - t0, 1)
        s = api.summarize_query_result(payload)
        row_count = len(s["result"]["data"]) if s["result"] and s["result"].get("data") else 0
        results.append({
            "step_id": step["id"],
            "title": step["title"],
            "question": step["question"],
            "time_s": dt,
            "sql": s["sql"].get("sql") if s["sql"] else None,
            "result": s["result"]["data"] if s["result"] else None,
            "analysis": s["analysis"],
            "error": s["error"],
        })
        print(f"STEP {i+1}/{len(steps)} [{step['title']}] {dt}s rows={row_count}")

    json.dump({"pid": pid, "steps": results}, open("lxreport1.0/functional/analysis/tc-analysis-001-exec-results.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("SAVED exec results")


if __name__ == "__main__":
    main()
