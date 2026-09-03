"""问数审计记录的 API 返回结构。"""

from pydantic import BaseModel, Field


class QueryFeedbackSchema(BaseModel):
    score: str = Field(pattern="^(up|down)$")
    comment: str | None = Field(default=None, max_length=500)


class QueryAuditSchema(BaseModel):
    id: str
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
