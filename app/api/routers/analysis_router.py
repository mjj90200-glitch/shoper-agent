"""数据分析模式 API。"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.dependencies import get_current_user
from app.api.schemas.analysis_schema import (
    AnalysisPlanRequest,
    AnalysisPlanResponse,
    AnalysisProjectPayload,
    AnalysisReport,
    AnalysisSummaryRequest,
)
from app.auth.service import UserIdentity
from app.services.analysis_planning_service import analysis_planning_service
from app.services.analysis_project_service import analysis_project_service

analysis_router = APIRouter(prefix="/api/analysis", tags=["data-analysis"])


@analysis_router.post("/plan", response_model=AnalysisPlanResponse)
async def create_analysis_plan(
    payload: AnalysisPlanRequest,
    _: Annotated[UserIdentity, Depends(get_current_user)],
) -> AnalysisPlanResponse:
    return await analysis_planning_service.create_plan(payload.goal)


@analysis_router.post("/summary", response_model=AnalysisReport)
async def create_analysis_summary(
    payload: AnalysisSummaryRequest,
    _: Annotated[UserIdentity, Depends(get_current_user)],
) -> AnalysisReport:
    return await analysis_planning_service.summarize(payload)


@analysis_router.get("/projects", response_model=list[AnalysisProjectPayload])
async def list_analysis_projects(
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    return analysis_project_service.list(user.username)


@analysis_router.put("/projects/{project_id}", response_model=AnalysisProjectPayload)
async def save_analysis_project(
    project_id: str,
    payload: AnalysisProjectPayload,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    if str(payload.id) != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目编号不一致。")
    try:
        return analysis_project_service.save(user.username, payload.model_dump(mode="json"))
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(error)) from error


@analysis_router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_analysis_project(
    project_id: str,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    analysis_project_service.delete(user.username, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
