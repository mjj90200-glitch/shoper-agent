"""当前登录用户的问数审计记录接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_current_user
from app.api.schemas.audit_schema import QueryAuditSchema, QueryFeedbackSchema
from app.audit.service import query_audit_service
from app.auth.service import UserIdentity

audit_router = APIRouter(prefix="/api/audits", tags=["audits"])


@audit_router.get("/me", response_model=list[QueryAuditSchema])
async def list_my_audits(
    user: Annotated[UserIdentity, Depends(get_current_user)],
    limit: int = Query(default=30, ge=1, le=100),
):
    """只返回当前用户自己的记录，避免审计页面跨用户泄露查询内容。"""

    return query_audit_service.list_for_user(user.username, limit)


@audit_router.put("/{audit_id}/feedback", response_model=QueryAuditSchema)
async def submit_feedback(
    audit_id: str,
    payload: QueryFeedbackSchema,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    """为本人已完成的问数提交或更新反馈。"""

    record = query_audit_service.submit_feedback(
        audit_id, user.username, payload.score, payload.comment
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到可反馈的查询记录。",
        )
    return record
