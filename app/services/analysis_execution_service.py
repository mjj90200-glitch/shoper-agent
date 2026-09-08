"""可在浏览器断开后继续运行的数据分析后台任务。"""

import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable

from app.api.schemas.analysis_schema import AnalysisReport, AnalysisSummaryRequest
from app.auth.service import UserIdentity
from app.clients.embedding_client_manager import embedding_client_manager
from app.clients.es_client_manager import es_client_manager
from app.clients.mysql_client_manager import (
    dw_mysql_client_manager,
    meta_mysql_client_manager,
)
from app.clients.qdrant_client_manager import qdrant_client_manager
from app.repositories.es.value_es_repository import ValueESRepository
from app.repositories.mysql.dw.dw_mysql_repository import DWMySQLRepository
from app.repositories.mysql.meta.meta_mysql_repository import MetaMySQLRepository
from app.repositories.qdrant.column_qdrant_repository import ColumnQdrantRepository
from app.repositories.qdrant.metric_qdrant_repository import MetricQdrantRepository
from app.services.analysis_planning_service import analysis_planning_service
from app.services.analysis_project_service import analysis_project_service
from app.services.query_service import QueryService

QueryStreamFactory = Callable[[str, str, UserIdentity], AsyncIterator[str]]
SummaryFactory = Callable[[AnalysisSummaryRequest], Awaitable[AnalysisReport]]


class AnalysisExecutionError(Exception):
    pass


class AnalysisExecutionService:
    def __init__(
        self,
        query_stream_factory: QueryStreamFactory | None = None,
        summary_factory: SummaryFactory | None = None,
    ):
        self._tasks: dict[tuple[str, str], asyncio.Task] = {}
        self._query_stream_factory = query_stream_factory or self._stream_query
        self._summary_factory = summary_factory or analysis_planning_service.summarize

    async def _stream_query(
        self, question: str, session_id: str, user: UserIdentity
    ) -> AsyncIterator[str]:
        if not meta_mysql_client_manager.session_factory or not dw_mysql_client_manager.session_factory:
            raise AnalysisExecutionError("数据库客户端尚未初始化。")
        if not embedding_client_manager.client or not qdrant_client_manager.client or not es_client_manager.client:
            raise AnalysisExecutionError("检索客户端尚未初始化。")
        async with (
            meta_mysql_client_manager.session_factory() as meta_session,
            dw_mysql_client_manager.session_factory() as dw_session,
        ):
            service = QueryService(
                meta_mysql_repository=MetaMySQLRepository(meta_session),
                embedding_client=embedding_client_manager.client,
                dw_mysql_repository=DWMySQLRepository(dw_session),
                column_qdrant_repository=ColumnQdrantRepository(qdrant_client_manager.client),
                metric_qdrant_repository=MetricQdrantRepository(qdrant_client_manager.client),
                value_es_repository=ValueESRepository(es_client_manager.client),
            )
            async for event in service.query(question, session_id, user):
                yield event

    @staticmethod
    def _event(raw: str) -> dict | None:
        for line in raw.splitlines():
            if line.startswith("data: "):
                return json.loads(line[6:])
        return None

    @staticmethod
    def _set_run(project: dict, step_id: str, **patch) -> None:
        project["runs"] = [
            {**run, **patch} if run.get("stepId") == step_id else run
            for run in project.get("runs", [])
        ]
        project["updatedAt"] = int(time.time() * 1000)

    def start(
        self,
        username: str,
        user: UserIdentity,
        project_id: str,
        step_id: str | None = None,
    ) -> dict:
        key = (username, project_id)
        running = self._tasks.get(key)
        if running and not running.done():
            raise AnalysisExecutionError("该分析项目正在执行，请勿重复启动。")
        project = analysis_project_service.snapshot(username, project_id)
        if project is None:
            raise AnalysisExecutionError("未找到分析项目。")
        steps = (project.get("plan") or {}).get("steps", [])
        if not steps:
            raise AnalysisExecutionError("请先生成并确认分析计划。")
        if step_id and not any(step.get("id") == step_id for step in steps):
            raise AnalysisExecutionError("未找到指定分析步骤。")

        selected = (
            {step_id}
            if step_id
            else {str(step.get("id")) for step in steps}
            if project.get("status") == "complete"
            else {
                str(step.get("id"))
                for step in steps
                if next(
                    (
                        run.get("status")
                        for run in project.get("runs", [])
                        if run.get("stepId") == step.get("id")
                    ),
                    "pending",
                )
                != "done"
            }
        )
        if not selected:
            raise AnalysisExecutionError("所有分析步骤均已完成。")
        self._prepare(project, selected)
        analysis_project_service.save(username, project)
        task = asyncio.create_task(self._run(username, user, project, selected))
        self._tasks[key] = task
        task.add_done_callback(lambda _: self._tasks.pop(key, None))
        return project

    def _prepare(self, project: dict, selected: set[str]) -> None:
        known = {run.get("stepId"): run for run in project.get("runs", [])}
        project["runs"] = [
            (
                {"stepId": step["id"], "status": "pending", "progress": []}
                if step["id"] in selected
                else known.get(step["id"], {"stepId": step["id"], "status": "pending", "progress": []})
            )
            for step in project["plan"]["steps"]
        ]
        project["status"] = "running"
        project["report"] = None
        project["updatedAt"] = int(time.time() * 1000)

    async def _run(
        self,
        username: str,
        user: UserIdentity,
        project: dict,
        selected: set[str],
    ) -> None:
        try:
            for step in project["plan"]["steps"]:
                step_id = str(step["id"])
                if step_id not in selected:
                    continue
                self._set_run(project, step_id, status="running", progress=[], error=None)
                analysis_project_service.save(username, project)
                got_result = False
                async for raw in self._query_stream_factory(
                    step["question"], str(project["id"]), user
                ):
                    event = self._event(raw)
                    if event is None:
                        continue
                    run = next(item for item in project["runs"] if item["stepId"] == step_id)
                    if event["type"] == "progress":
                        progress = [item for item in run.get("progress", []) if item.get("step") != event.get("step")]
                        progress.append({**event, "updatedAt": int(time.time() * 1000)})
                        self._set_run(project, step_id, progress=progress)
                    elif event["type"] == "result":
                        got_result = True
                        self._set_run(project, step_id, result=event.get("data"))
                    elif event["type"] == "analysis":
                        self._set_run(
                            project,
                            step_id,
                            analysis={key: value for key, value in event.items() if key != "type"},
                        )
                    elif event["type"] == "sql":
                        self._set_run(project, step_id, sql=event.get("sql"))
                    elif event["type"] == "audit_context":
                        self._set_run(project, step_id, auditId=event.get("audit_id"))
                    elif event["type"] in {"error", "assistant_message"}:
                        self._set_run(
                            project,
                            step_id,
                            status="error",
                            error=event.get("message", "分析步骤没有返回数据结果。"),
                        )
                    analysis_project_service.save(username, project)
                run = next(item for item in project["runs"] if item["stepId"] == step_id)
                if run.get("status") != "error":
                    self._set_run(
                        project,
                        step_id,
                        status="done" if got_result else "error",
                        error=None if got_result else "分析步骤没有返回数据结果。",
                    )
                    analysis_project_service.save(username, project)

            project["status"] = (
                "error"
                if any(run.get("status") == "error" for run in project["runs"])
                else "complete"
            )
            if project["status"] == "complete":
                request = AnalysisSummaryRequest.model_validate(
                    {
                        "goal": project["goal"],
                        "steps": [
                            {
                                "id": step["id"],
                                "title": step["title"],
                                "question": step["question"],
                                "result": next(run for run in project["runs"] if run["stepId"] == step["id"]).get("result"),
                                "analysis": next(run for run in project["runs"] if run["stepId"] == step["id"]).get("analysis"),
                            }
                            for step in project["plan"]["steps"]
                        ],
                    }
                )
                report = await self._summary_factory(request)
                project["report"] = report.model_dump(mode="json")
            project["updatedAt"] = int(time.time() * 1000)
            analysis_project_service.save(username, project)
        except asyncio.CancelledError:
            project["status"] = "review"
            project["runs"] = [
                {**run, "status": "pending"} if run.get("status") == "running" else run
                for run in project["runs"]
            ]
            project["updatedAt"] = int(time.time() * 1000)
            analysis_project_service.save(username, project)
            raise
        except Exception as error:
            project["status"] = "error"
            project["runs"] = [
                {**run, "status": "error", "error": str(error)}
                if run.get("status") == "running"
                else run
                for run in project["runs"]
            ]
            project["updatedAt"] = int(time.time() * 1000)
            analysis_project_service.save(username, project)

    async def stop(self, username: str, project_id: str) -> dict:
        task = self._tasks.get((username, project_id))
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        project = analysis_project_service.snapshot(username, project_id)
        if project is None:
            raise AnalysisExecutionError("未找到分析项目。")
        return project

    async def shutdown(self) -> None:
        tasks = [task for task in self._tasks.values() if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


analysis_execution_service = AnalysisExecutionService()
