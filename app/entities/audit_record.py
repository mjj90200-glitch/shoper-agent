"""审计记录实体：一次问数请求的完整审计字段。"""

from dataclasses import asdict, dataclass


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
