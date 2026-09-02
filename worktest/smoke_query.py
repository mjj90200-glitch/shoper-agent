"""冒烟测试：向本地 API 发一次问数并汇总 SSE 事件。"""

import json
import sys
import uuid
from urllib.request import Request, urlopen

base_url = "http://127.0.0.1:8000"
query = sys.argv[1] if len(sys.argv) > 1 else "统计华东地区 2025 年第一季度的销售总额"
session_id = sys.argv[2] if len(sys.argv) > 2 else str(uuid.uuid4())

payload = json.dumps({"query": query, "session_id": session_id}).encode()
req = Request(
    f"{base_url}/api/query",
    data=payload,
    headers={"Content-Type": "application/json", "Accept": "text/event-stream"},
    method="POST",
)
events = []
with urlopen(req, timeout=180) as resp:
    body = resp.read().decode()
    for chunk in body.split("\n\n"):
        data = "\n".join(
            line.removeprefix("data:").strip()
            for line in chunk.splitlines()
            if line.startswith("data:")
        )
        if data:
            events.append(json.loads(data))

out = {
    "query": query,
    "session_id": session_id,
    "event_types": [e.get("type") for e in events],
}
for e in events:
    if e.get("type") == "query_context":
        out["resolved_query"] = e.get("resolved_query")
    if e.get("type") == "sql":
        out["sql"] = e.get("sql")
    if e.get("type") == "assistant_message":
        out["message"] = e.get("content")
    if e.get("type") == "error":
        out.setdefault("errors", []).append(e)
print(json.dumps(out, ensure_ascii=False, indent=2))
