"""把业务分析目标拆成可审核、可逐步问数的执行计划。"""

import json

from app.agent.llm import llm
from app.api.schemas.analysis_schema import (
    AnalysisEvidence,
    AnalysisFollowUpResponse,
    AnalysisPlanResponse,
    AnalysisPlanStep,
    AnalysisReport,
    AnalysisSummaryRequest,
)

WAREHOUSE_SCOPE = """
当前数仓是电商销售数仓，仅包含：地区、客户、商品、日期和订单事实。
可分析销售额、销量、订单、商品、品类、品牌、地区、会员等级和日期趋势。
不得编造库存、成本、利润、广告、流量、竞品或外部市场数据。
""".strip()


def fallback_plan(goal: str) -> AnalysisPlanResponse:
    concise_goal = " ".join(goal.split())
    title = concise_goal[:18] + ("…" if len(concise_goal) > 18 else "")
    return AnalysisPlanResponse(
        title=title,
        summary="围绕目标先建立整体基线，再拆解关键维度并定位值得关注的差异。",
        steps=[
            AnalysisPlanStep(
                id="baseline",
                title="建立整体基线",
                question=f"围绕“{concise_goal}”，统计相关的总体销售额、销量和订单量",
                purpose="明确当前总体规模，作为后续比较基准。",
            ),
            AnalysisPlanStep(
                id="trend",
                title="观察时间趋势",
                question=f"围绕“{concise_goal}”，按月统计销售额和销量并按时间排序",
                purpose="识别增长、回落和异常时间点。",
            ),
            AnalysisPlanStep(
                id="breakdown",
                title="拆解关键维度",
                question=f"围绕“{concise_goal}”，按地区和商品品类分析销售额，列出贡献最高的前 10 项",
                purpose="定位主要贡献来源和结构差异。",
            ),
        ],
    )


class AnalysisPlanningService:
    async def create_plan(self, goal: str) -> AnalysisPlanResponse:
        prompt = f"""
你是电商数据分析规划师。请把用户目标拆成 2 到 5 个可以独立交给问数智能体执行的问题。

{WAREHOUSE_SCOPE}

要求：
1. 每一步只查询当前数仓，问题必须具体、可生成 SQL。
2. 步骤由整体到局部，避免重复。
3. 不承诺因果结论，只做数仓现有数据支持的描述性分析。
4. id 使用简短英文小写标识；标题、问题、目的使用中文。
5. 只返回一个 JSON 对象，不要 Markdown。格式为：
{{"title":"分析标题","summary":"计划摘要","steps":[{{"id":"baseline","title":"步骤标题","question":"可直接执行的问数问题","purpose":"本步骤用途"}}]}}

用户目标：{goal}
""".strip()
        try:
            response = await llm.ainvoke(prompt)
            content = response.content
            if isinstance(content, list):
                content = "".join(str(part) for part in content)
            raw = str(content)
            start, end = raw.find("{"), raw.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("规划模型没有返回 JSON")
            return AnalysisPlanResponse.model_validate(json.loads(raw[start : end + 1]))
        except Exception:
            # 规划服务不可用时仍给出可审核的保守计划，执行阶段继续走既有问数链路。
            return fallback_plan(goal)

    async def summarize(self, payload: AnalysisSummaryRequest) -> AnalysisReport:
        compact_steps = [
            {
                "id": step.id,
                "title": step.title,
                "question": step.question,
                "analysis": step.analysis,
                "result": step.result[:20] if isinstance(step.result, list) else step.result,
            }
            for step in payload.steps
        ]
        prompt = f"""
你是电商数据分析师。只依据给出的真实查询结果完成综合分析，不得补造数字或因果关系。
分析目标：{payload.goal}
步骤结果：{json.dumps(compact_steps, ensure_ascii=False, default=str)}

只返回 JSON：
{{"overview":"总体结论","findings":["关键发现"],"recommendations":["可执行建议"],"cautions":["口径或数据限制"],"evidence":[{{"finding":"关键发现","step_ids":["步骤ID"],"data_points":["结果中原样出现的字段和值"]}}]}}
""".strip()
        try:
            response = await llm.ainvoke(prompt)
            raw = str(response.content)
            start, end = raw.find("{"), raw.rfind("}")
            report = AnalysisReport.model_validate(json.loads(raw[start : end + 1]))
            allowed = {step.id: step for step in payload.steps}
            evidence = []
            for item in report.evidence:
                step_ids = [step_id for step_id in item.step_ids if step_id in allowed]
                if not step_ids:
                    continue
                source = json.dumps(
                    [allowed[step_id].result for step_id in step_ids],
                    ensure_ascii=False,
                    default=str,
                )
                data_points = [point for point in item.data_points if point in source]
                evidence.append(
                    AnalysisEvidence(
                        finding=item.finding,
                        step_ids=step_ids,
                        data_points=data_points,
                    )
                )
            return report.model_copy(update={"evidence": evidence})
        except Exception:
            findings = []
            evidence = []
            for step in payload.steps:
                summary = (step.analysis or {}).get("summary")
                if summary:
                    finding = f"{step.title}：{summary}"
                    findings.append(finding)
                    evidence.append(
                        AnalysisEvidence(
                            finding=finding,
                            step_ids=[step.id],
                            data_points=[],
                        )
                    )
            return AnalysisReport(
                overview=f"已围绕“{payload.goal}”完成 {len(payload.steps)} 个分析步骤。",
                findings=findings or ["各分析步骤已完成，请结合下方图表与明细查看结果。"],
                recommendations=["优先复核贡献最高和变化最明显的维度，再结合业务背景制定行动。"],
                cautions=["结论仅基于当前电商数仓中的销售数据，不代表因果关系。"],
                evidence=evidence,
            )

    async def follow_up(self, project: dict, question: str) -> AnalysisFollowUpResponse:
        completed_steps = []
        step_by_id = {
            str(step.get("id")): step for step in (project.get("plan") or {}).get("steps", [])
        }
        for run in project.get("runs", []):
            if run.get("status") != "done" or run.get("result") is None:
                continue
            step_id = str(run.get("stepId"))
            step = step_by_id.get(step_id, {})
            completed_steps.append(
                {
                    "id": step_id,
                    "title": step.get("title", step_id),
                    "question": step.get("question", ""),
                    "analysis": run.get("analysis"),
                    "result": run.get("result", [])[:20]
                    if isinstance(run.get("result"), list)
                    else run.get("result"),
                }
            )
        if not completed_steps:
            raise ValueError("当前项目还没有可用于追问的已完成结果。")

        prompt = f"""
你是电商数据分析助理。只能依据提供的已完成步骤回答，不得使用外部事实或编造数字。
如果数据不足，必须明确说明限制。建议必须说明它是建议，不得伪装成数据事实。

分析目标：{project.get('goal', '')}
用户追问：{question}
步骤结果：{json.dumps(completed_steps, ensure_ascii=False, default=str)}

只返回 JSON：
{{"answer":"回答","step_ids":["支持回答的步骤ID"],"caution":"数据不足或口径提醒，可为 null"}}
""".strip()
        try:
            response = await llm.ainvoke(prompt)
            raw = str(response.content)
            start, end = raw.find("{"), raw.rfind("}")
            result = AnalysisFollowUpResponse.model_validate(
                json.loads(raw[start : end + 1])
            )
            allowed_ids = {step["id"] for step in completed_steps}
            return result.model_copy(
                update={
                    "step_ids": [
                        step_id for step_id in result.step_ids if step_id in allowed_ids
                    ]
                }
            )
        except Exception:
            report = project.get("report") or {}
            answer = report.get("overview") or "现有步骤结果不足以形成可靠回答。"
            return AnalysisFollowUpResponse(
                answer=answer,
                step_ids=[step["id"] for step in completed_steps],
                caution="当前为保守回答，请结合引用步骤中的真实数据核对。",
            )


analysis_planning_service = AnalysisPlanningService()
