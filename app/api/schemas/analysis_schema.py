"""数据分析工作区的计划接口模型。"""

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AnalysisPlanRequest(BaseModel):
    goal: str = Field(min_length=5, max_length=1000)


class AnalysisPlanStep(BaseModel):
    id: str
    title: str = Field(min_length=2, max_length=40)
    question: str = Field(min_length=3, max_length=300)
    purpose: str = Field(min_length=2, max_length=160)


class AnalysisPlanResponse(BaseModel):
    title: str = Field(min_length=2, max_length=40)
    summary: str = Field(min_length=2, max_length=240)
    steps: list[AnalysisPlanStep] = Field(min_length=2, max_length=6)


class AnalysisEvidence(BaseModel):
    finding: str = Field(min_length=2, max_length=400)
    step_ids: list[str] = Field(min_length=1, max_length=6)
    data_points: list[str] = Field(default_factory=list, max_length=8)


class AnalysisReport(BaseModel):
    overview: str = Field(min_length=2, max_length=600)
    findings: list[str] = Field(min_length=1, max_length=8)
    recommendations: list[str] = Field(default_factory=list, max_length=6)
    cautions: list[str] = Field(default_factory=list, max_length=6)
    evidence: list[AnalysisEvidence] = Field(default_factory=list, max_length=8)


class AnalysisSummaryStep(BaseModel):
    id: str
    title: str
    question: str
    result: Any = None
    analysis: dict[str, Any] | None = None


class AnalysisSummaryRequest(BaseModel):
    goal: str = Field(min_length=5, max_length=1000)
    steps: list[AnalysisSummaryStep] = Field(min_length=1, max_length=6)


class AnalysisRunRequest(BaseModel):
    step_id: str | None = None


class AnalysisFollowUpRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)


class AnalysisFollowUpResponse(BaseModel):
    answer: str = Field(min_length=2, max_length=1200)
    step_ids: list[str] = Field(default_factory=list, max_length=6)
    caution: str | None = Field(default=None, max_length=300)


class AnalysisFollowUpRecord(AnalysisFollowUpResponse):
    id: str
    question: str
    createdAt: int


class AnalysisProjectPayload(BaseModel):
    id: UUID
    title: str = Field(min_length=1, max_length=80)
    goal: str = Field(max_length=1000)
    status: Literal["draft", "review", "running", "complete", "error"]
    plan: dict[str, Any] | None = None
    runs: list[dict[str, Any]] = Field(default_factory=list, max_length=6)
    report: AnalysisReport | None = None
    followUps: list[AnalysisFollowUpRecord] = Field(default_factory=list, max_length=20)
    createdAt: int
    updatedAt: int
