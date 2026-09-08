"""基于执行结果生成综合分析报告，验证数字一致性。"""

from __future__ import annotations

import importlib.util
import json
import time

spec = importlib.util.spec_from_file_location("api_tests", "lxreport1.0/tools/api_tests.py")
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)


def main():
    status, body = api.login("admin", "admin123")
    token = body["access_token"]
    exec_data = json.load(open("lxreport1.0/functional/analysis/tc-analysis-001-exec-results.json", encoding="utf-8"))
    pid = exec_data["pid"]
    steps = exec_data["steps"]
    goal = "分析 2025 年各地区销售表现，找出贡献最高的品类和异常月份"

    summary_steps = [
        {
            "title": s["title"],
            "question": s["question"],
            "result": s["result"],
            "analysis": s["analysis"],
        }
        for s in steps
    ]
    t0 = time.time()
    status, report = api.request(
        "POST", "/api/analysis/summary", token=token,
        body={"goal": goal, "steps": summary_steps}, timeout=180,
    )
    dt = round(time.time() - t0, 1)
    print(f"SUMMARY: status={status} time={dt}s")
    json.dump(
        {"goal": goal, "pid": pid, "status": status, "time_s": dt, "report": report},
        open("lxreport1.0/functional/analysis/tc-analysis-001-summary.json", "w", encoding="utf-8"),
        ensure_ascii=False, indent=2,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2)[:3000])


if __name__ == "__main__":
    main()
