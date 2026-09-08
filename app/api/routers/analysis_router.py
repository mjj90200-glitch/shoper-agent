"""数据分析模式 API。"""

from time import time
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.dependencies import get_current_user
from app.api.schemas.analysis_schema import (
    AnalysisFollowUpRecord,
    AnalysisFollowUpRequest,
    AnalysisFollowUpResponse,
    AnalysisPlanRequest,
    AnalysisPlanResponse,
    AnalysisProjectPayload,
    AnalysisReport,
    AnalysisRunRequest,
    AnalysisSummaryRequest,
)
from app.auth.service import UserIdentity
from app.services.analysis_execution_service import (
    AnalysisExecutionError,
    analysis_execution_service,
)
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


@analysis_router.get("/projects/{project_id}", response_model=AnalysisProjectPayload)
async def get_analysis_project(
    project_id: str,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    project = analysis_project_service.snapshot(user.username, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到分析项目。")
    return project


@analysis_router.put("/projects/{project_id}", response_model=AnalysisProjectPayload)
async def save_analysis_project(
    project_id: str,
    payload: AnalysisProjectPayload,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    if str(payload.id) != project_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="项目编号不一致。")
    try:
        return analysis_project_service.save_from_client(
            user.username, payload.model_dump(mode="json")
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(error)) from error


@analysis_router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_analysis_project(
    project_id: str,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    if analysis_project_service.get(user.username, project_id) is not None:
        await analysis_execution_service.stop(user.username, project_id)
    analysis_project_service.delete(user.username, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@analysis_router.post(
    "/projects/{project_id}/run",
    response_model=AnalysisProjectPayload,
    status_code=status.HTTP_202_ACCEPTED,
)
async def run_analysis_project(
    project_id: str,
    payload: AnalysisRunRequest,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    try:
        return analysis_execution_service.start(
            user.username, user, project_id, payload.step_id
        )
    except AnalysisExecutionError as error:
        code = (
            status.HTTP_404_NOT_FOUND
            if str(error) in {"未找到分析项目。", "未找到指定分析步骤。"}
            else status.HTTP_409_CONFLICT
        )
        raise HTTPException(status_code=code, detail=str(error)) from error


@analysis_router.post(
    "/projects/{project_id}/stop", response_model=AnalysisProjectPayload
)
async def stop_analysis_project(
    project_id: str,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    try:
        return await analysis_execution_service.stop(user.username, project_id)
    except AnalysisExecutionError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(error)
        ) from error


@analysis_router.post(
    "/projects/{project_id}/follow-up", response_model=AnalysisFollowUpResponse
)
async def follow_up_analysis_project(
    project_id: str,
    payload: AnalysisFollowUpRequest,
    user: Annotated[UserIdentity, Depends(get_current_user)],
):
    project = analysis_project_service.snapshot(user.username, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到分析项目。")
    if project.get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="分析仍在执行，请完成后再追问。",
        )
    try:
        answer = await analysis_planning_service.follow_up(project, payload.question)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(error)
        ) from error
    record = AnalysisFollowUpRecord(
        id=str(uuid4()),
        question=payload.question,
        createdAt=int(time() * 1000),
        **answer.model_dump(),
    )
    project["followUps"] = [*project.get("followUps", []), record.model_dump(mode="json")][-20:]
    project["updatedAt"] = record.createdAt
    analysis_project_service.save(user.username, project)
    return answer
