"""保存完整分析项目为 complete 状态，验证持久化恢复。"""

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
    plan_data = json.load(open("lxreport1.0/functional/analysis/tc-analysis-001-plan-clean.json", encoding="utf-8"))
    summary_data = json.load(open("lxreport1.0/functional/analysis/tc-analysis-001-summary.json", encoding="utf-8"))
    goal = plan_data["goal"]
    plan = plan_data["plan"]
    report = summary_data["report"]

    ts = int(time.time() * 1000)
    project = {
        "id": pid,
        "title": "2025年各地区销售表现与品类贡献、异常月份分析",
        "goal": goal,
        "status": "complete",
        "plan": {"title": plan["title"], "summary": plan["summary"], "steps": plan["steps"]},
        "runs": [
            {
                "id": s["step_id"],
                "title": s["title"],
                "question": s["question"],
                "status": "complete",
                "result": {"data": s["result"]},
                "analysis": s["analysis"],
                "sql": s["sql"],
            }
            for s in exec_data["steps"]
        ],
        "report": report,
        "createdAt": ts,
        "updatedAt": ts,
    }
    status, body = api.request("PUT", f"/api/analysis/projects/{pid}", token=token, body=project)
    print(f"SAVE COMPLETE: status={status}")
    json.dump({"pid": pid, "status": status, "body": body}, open("lxreport1.0/functional/analysis/tc-analysis-001-save-complete.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # 读取验证
    status, projects = api.request("GET", "/api/analysis/projects", token=token)
    match = next((p for p in projects if p.get("id") == pid), None) if isinstance(projects, list) else None
    ok = match is not None and match.get("status") == "complete" and match.get("report") is not None
    print(f"READ BACK: found={match is not None} status={match.get('status') if match else None} has_report={bool(match and match.get('report'))}")
    json.dump({"pid": pid, "read_back_ok": ok, "project": match}, open("lxreport1.0/functional/analysis/tc-analysis-002-persist-readback.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
