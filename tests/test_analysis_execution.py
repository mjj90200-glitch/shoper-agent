"""数据分析后台执行和报告溯源测试。"""

import asyncio
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.api.schemas.analysis_schema import AnalysisReport, AnalysisSummaryRequest
from app.auth.service import UserIdentity
from app.services.analysis_execution_service import AnalysisExecutionService
from app.services.analysis_planning_service import AnalysisPlanningService
from app.services.analysis_project_service import analysis_project_service


def project_payload() -> dict:
    return {
        "id": "2bc87f17-65fd-4074-8da6-0aa6e6ee0c45",
        "title": "地区销售分析",
        "goal": "分析 2025 年各地区销售表现",
        "status": "review",
        "plan": {
            "title": "地区销售分析",
            "summary": "先分析地区贡献。",
            "steps": [
                {
                    "id": "region",
                    "title": "地区贡献",
                    "question": "统计各地区销售额并排序",
                    "purpose": "识别主要地区。",
                }
            ],
        },
        "runs": [{"stepId": "region", "status": "pending", "progress": []}],
        "report": None,
        "followUps": [],
        "createdAt": 1,
        "updatedAt": 1,
    }


def event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


class AnalysisExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = TemporaryDirectory()
        analysis_project_service.configure_database(
            Path(self.directory.name) / "state.sqlite"
        )
        analysis_project_service.save("alice", project_payload())
        self.user = UserIdentity("alice", "Alice", "analyst", (), ())

    async def asyncTearDown(self):
        self.directory.cleanup()

    async def test_background_run_persists_result_and_report(self):
        async def stream_query(question, session_id, user):
            self.assertEqual(question, "统计各地区销售额并排序")
            self.assertEqual(session_id, project_payload()["id"])
            self.assertEqual(user, self.user)
            yield event({"type": "progress", "step": "执行 SQL", "status": "running"})
            yield event({"type": "sql", "sql": "SELECT region, SUM(amount) FROM sales"})
            yield event({"type": "result", "data": [{"region": "华东", "amount": 120}]})
            yield event({"type": "analysis", "summary": "华东销售额为 120", "chart": None})

        async def summarize(_: AnalysisSummaryRequest) -> AnalysisReport:
            return AnalysisReport(
                overview="华东贡献领先。",
                findings=["华东销售额为 120"],
                evidence=[
                    {
                        "finding": "华东销售额为 120",
                        "step_ids": ["region"],
                        "data_points": ["120"],
                    }
                ],
            )

        service = AnalysisExecutionService(stream_query, summarize)
        started = service.start("alice", self.user, project_payload()["id"])
        task = service._tasks[("alice", project_payload()["id"])]
        self.assertEqual(started["status"], "running")
        await task

        stored = analysis_project_service.get("alice", project_payload()["id"])
        self.assertEqual(stored["status"], "complete")
        self.assertEqual(stored["runs"][0]["status"], "done")
        self.assertEqual(stored["runs"][0]["result"][0]["amount"], 120)
        self.assertEqual(stored["report"]["evidence"][0]["step_ids"], ["region"])

    async def test_stop_turns_running_step_back_to_pending(self):
        entered = asyncio.Event()

        async def slow_stream(*_):
            entered.set()
            yield event({"type": "progress", "step": "执行 SQL", "status": "running"})
            await asyncio.Event().wait()

        service = AnalysisExecutionService(slow_stream)
        service.start("alice", self.user, project_payload()["id"])
        await entered.wait()
        stopped = await service.stop("alice", project_payload()["id"])

        self.assertEqual(stopped["status"], "review")
        self.assertEqual(stopped["runs"][0]["status"], "pending")


class AnalysisEvidenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_summary_filters_unknown_steps_and_fabricated_data_points(self):
        model = SimpleNamespace(
            ainvoke=AsyncMock(
                return_value=SimpleNamespace(
                    content=json.dumps(
                        {
                            "overview": "华东领先。",
                            "findings": ["华东销售额为 120"],
                            "recommendations": [],
                            "cautions": [],
                            "evidence": [
                                {
                                    "finding": "华东销售额为 120",
                                    "step_ids": ["region", "invented"],
                                    "data_points": ["120", "999"],
                                }
                            ],
                        },
                        ensure_ascii=False,
                    )
                )
            )
        )
        payload = AnalysisSummaryRequest.model_validate(
            {
                "goal": "分析 2025 年各地区销售表现",
                "steps": [
                    {
                        "id": "region",
                        "title": "地区贡献",
                        "question": "统计各地区销售额",
                        "result": [{"region": "华东", "amount": 120}],
                    }
                ],
            }
        )

        with patch("app.services.analysis_planning_service.llm", model):
            report = await AnalysisPlanningService().summarize(payload)

        self.assertEqual(report.evidence[0].step_ids, ["region"])
        self.assertEqual(report.evidence[0].data_points, ["120"])

    async def test_follow_up_rejects_project_without_completed_results(self):
        with self.assertRaisesRegex(ValueError, "没有可用于追问"):
            await AnalysisPlanningService().follow_up(project_payload(), "下一步怎么做？")


if __name__ == "__main__":
    unittest.main()
