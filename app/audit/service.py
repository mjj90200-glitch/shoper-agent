"""本地演示版问数审计服务。"""

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from threading import Lock
from time import perf_counter
from uuid import uuid4


@dataclass
class QueryAuditRecord:
    id: str
    username: str
    session_id: str
    query: str
    resolved_query: str | None
    sql: str | None
    result_row_count: int | None
    terminal_type: str | None
    status: str
    error: str | None
    feedback_score: str | None
    feedback_comment: str | None
    feedback_at: str | None
    started_at: str
    duration_ms: int | None
    _started_monotonic: float

    def to_dict(self) -> dict:
        data = asdict(self)
        data.pop("_started_monotonic")
        return data


class QueryAuditService:
    """仅保留当前进程审计记录，供本地演示和后续持久化实现替换。"""

    def __init__(self, max_records: int = 500):
        self._max_records = max_records
        self._records: list[QueryAuditRecord] = []
        self._lock = Lock()

    def start(self, username: str, session_id: str, query: str) -> QueryAuditRecord:
        record = QueryAuditRecord(
            id=str(uuid4()),
            username=username,
            session_id=session_id,
            query=query,
            resolved_query=None,
            sql=None,
            result_row_count=None,
            terminal_type=None,
            status="running",
            error=None,
            feedback_score=None,
            feedback_comment=None,
            feedback_at=None,
            started_at=datetime.now(UTC).isoformat(),
            duration_ms=None,
            _started_monotonic=perf_counter(),
        )
        with self._lock:
            self._records.append(record)
            if len(self._records) > self._max_records:
                self._records = self._records[-self._max_records :]
        return record

    def observe(self, record: QueryAuditRecord, event: dict) -> None:
        """从 SSE 业务事件补齐审计字段，不保存原始结果数据。"""

        event_type = event.get("type")
        with self._lock:
            if event_type == "query_context":
                record.resolved_query = event.get("resolved_query")
            elif event_type == "sql":
                record.sql = event.get("sql")
            elif event_type == "result":
                data = event.get("data")
                record.result_row_count = len(data) if isinstance(data, list) else None
                record.terminal_type = "result"
                record.status = "succeeded"
            elif event_type == "assistant_message":
                record.terminal_type = "assistant_message"
                record.status = "succeeded"
            elif event_type == "error":
                record.terminal_type = "error"
                record.status = "failed"
                record.error = str(event.get("message", "未知错误"))

    def finish(self, record: QueryAuditRecord) -> None:
        with self._lock:
            if record.status == "running":
                record.status = "failed"
                record.error = "请求未完成或连接已中断。"
            record.duration_ms = round((perf_counter() - record._started_monotonic) * 1000)

    def list_for_user(self, username: str, limit: int = 30) -> list[dict]:
        with self._lock:
            records = [record for record in self._records if record.username == username]
            return [record.to_dict() for record in reversed(records[-limit:])]

    def submit_feedback(
        self, audit_id: str, username: str, score: str, comment: str | None
    ) -> dict | None:
        """更新用户自己的已完成问数反馈，避免跨用户修改审计记录。"""

        with self._lock:
            record = next(
                (
                    item
                    for item in self._records
                    if item.id == audit_id and item.username == username
                ),
                None,
            )
            if record is None or record.status == "running":
                return None
            record.feedback_score = score
            record.feedback_comment = comment.strip() if comment else None
            record.feedback_at = datetime.now(UTC).isoformat()
            return record.to_dict()


query_audit_service = QueryAuditService()
