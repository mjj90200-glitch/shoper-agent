"""当前登录用户的问数审计记录接口。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dependencies import get_current_user
from app.api.schemas.audit_schema import (
    QualitySummarySchema,
    QueryAuditSchema,
    QueryFeedbackSchema,
    RenameSessionSchema,
    SessionSchema,
)
from app.audit.service import query_audit_service
from app.auth.service import UserIdentity

audit_router = APIRouter(prefix="/api/audits", tags=["audits"])
session_router = APIRouter(prefix="/api/sessions", tags=["sessions"])


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


@audit_router.get("/quality-summary", response_model=QualitySummarySchema)
async def quality_summary(user: Annotated[UserIdentity, Depends(get_current_user)]):
    """仅管理员可查看全局问数质量统计。"""

    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看质量看板。")
    return query_audit_service.quality_summary()


@session_router.get("", response_model=list[SessionSchema])
async def list_sessions(user: Annotated[UserIdentity, Depends(get_current_user)]):
    return query_audit_service.list_sessions(user.username)


@session_router.patch("/{session_id}", response_model=SessionSchema)
async def rename_session(
    session_id: str,
    payload: RenameSessionSchema,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    if not query_audit_service.rename_session(user.username, session_id, payload.title):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到会话。")
    return next(item for item in query_audit_service.list_sessions(user.username) if item["session_id"] == session_id)


@session_router.get("/{session_id}", response_model=list[QueryAuditSchema])
async def session_detail(
    session_id: str, user: Annotated[UserIdentity, Depends(get_current_user)]
):
    records = query_audit_service.list_for_session(user.username, session_id)
    if records is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到会话。")
    return records


@session_router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str, user: Annotated[UserIdentity, Depends(get_current_user)]
):
    if not query_audit_service.delete_session(user.username, session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到会话。")
