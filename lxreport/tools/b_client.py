"""9.03 B 部分 API 测试客户端。

用法：
  python b_client.py login <user> <pass> <out.json>
  python b_client.py query <session_id> <query_text> <out.json> [token]
  python b_client.py audits-me <token> <out.json>
  python b_client.py feedback <token> <audit_id> <up|down> [comment] <out.json>
  python b_client.py quality-summary <token> <out.json>
  python b_client.py sessions-list <token> <out.json>
  python b_client.py session-get <token> <session_id> <out.json>
  python b_client.py session-patch <token> <session_id> <title> <out.json>
  python b_client.py session-delete <token> <session_id> <out.json>

所有请求均带 Authorization: Bearer <token>（login 除外）。输出文件保存 HTTP 状态与响应体。
"""

import json
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:8000"


def _request(method: str, path: str, body=None, token=None, timeout: int = 240):
    headers = {}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if method == "POST" and path == "/api/query":
        headers["Accept"] = "text/event-stream"
    req = Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            if not raw:
                parsed = None
            elif "json" in content_type:
                parsed = json.loads(raw.decode("utf-8"))
            elif "event-stream" in content_type or method == "POST" and path == "/api/query":
                parsed = _parse_sse(raw.decode("utf-8"))
            else:
                parsed = raw.decode("utf-8")
            return resp.status, parsed
    except HTTPError as e:
        raw = e.read()
        if not raw:
            parsed = None
        else:
            try:
                parsed = json.loads(raw.decode("utf-8"))
            except Exception:
                parsed = raw.decode("utf-8", errors="replace")
        return e.code, parsed


def _parse_sse(body: str):
    events = []
    for chunk in body.split("\n\n"):
        payload = "\n".join(
            line.removeprefix("data:").strip()
            for line in chunk.splitlines()
            if line.startswith("data:")
        )
        if payload:
            events.append(json.loads(payload))
    return events


def _save(path: str, payload):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def main():
    action = sys.argv[1]
    if action == "login":
        _, _, username, password, out = sys.argv
        status, body = _request("POST", "/api/auth/login", {"username": username, "password": password})
        _save(out, {"http_status": status, "body": body})
        print(json.dumps({"http_status": status}, ensure_ascii=False))
        return
    if action == "query":
        session_id, query, out = sys.argv[2], sys.argv[3], sys.argv[4]
        token = sys.argv[5] if len(sys.argv) > 5 else None
        status, body = _request("POST", "/api/query", {"query": query, "session_id": session_id}, token=token)
        _save(out, {"http_status": status, "session_id": session_id, "query": query, "events": body})
        print(json.dumps({"http_status": status, "event_types": [e.get("type") for e in body]}, ensure_ascii=False))
        return
    if action == "feedback":
        token, audit_id, score, out = sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[-1]
        body_payload = {"score": score}
        if len(sys.argv) > 6:
            body_payload["comment"] = sys.argv[5]
        status, body = _request("PUT", f"/api/audits/{audit_id}/feedback", body_payload, token)
        _save(out, {"http_status": status, "audit_id": audit_id, "body": body})
        print(json.dumps({"http_status": status}, ensure_ascii=False))
        return
    # 其余动作：<token> <out> 或 <token> <session_id/audit> <...> <out>
    token = sys.argv[2]
    out = sys.argv[-1]
    if action == "audits-me":
        status, body = _request("GET", "/api/audits/me", token=token)
    elif action == "quality-summary":
        status, body = _request("GET", "/api/audits/quality-summary", token=token)
    elif action == "sessions-list":
        status, body = _request("GET", "/api/sessions", token=token)
    elif action == "session-get":
        status, body = _request("GET", f"/api/sessions/{sys.argv[3]}", token=token)
    elif action == "session-patch":
        status, body = _request("PATCH", f"/api/sessions/{sys.argv[3]}", {"title": sys.argv[4]}, token)
    elif action == "session-delete":
        status, body = _request("DELETE", f"/api/sessions/{sys.argv[3]}", token=token)
    else:
        raise SystemExit(f"未知动作: {action}")
    _save(out, {"http_status": status, "body": body})
    print(json.dumps({"http_status": status}, ensure_ascii=False))


if __name__ == "__main__":
    main()
