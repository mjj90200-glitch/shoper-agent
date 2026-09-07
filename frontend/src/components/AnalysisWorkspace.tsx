import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Download,
  FileText,
  LoaderCircle,
  PencilLine,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { createAnalysisPlan, createAnalysisSummary } from "../lib/analysisApi";
import { streamQuery } from "../lib/agentApi";
import { normalizeRows } from "../lib/dataAnalysis";
import { cn } from "../lib/format";
import type { AgentEvent, StepState } from "../types/agent";
import type { AnalysisPlanStep, AnalysisStepRun, DataAnalysisProject } from "../types/analysis";
import { ResultInsight } from "./ResultInsight";
import { ResultTable } from "./ResultTable";

type Props = {
  project: DataAnalysisProject;
  accessToken: string;
  onChange: (project: DataAnalysisProject) => void;
};

function upsertProgress(items: StepState[], event: Extract<AgentEvent, { type: "progress" }>) {
  return [...items.filter((item) => item.step !== event.step), { step: event.step, status: event.status, updatedAt: Date.now() }];
}

export function AnalysisWorkspace({ project, accessToken, onChange }: Props) {
  const [goal, setGoal] = useState(project.goal);
  const [planning, setPlanning] = useState(false);
  const [controller, setController] = useState<AbortController | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const completed = project.runs.filter((run) => run.status === "done").length;
  const isRunning = project.status === "running";

  const runById = useMemo(
    () => new Map(project.runs.map((run) => [run.stepId, run])),
    [project.runs],
  );

  const updateProject = (patch: Partial<DataAnalysisProject>) => {
    onChange({ ...project, ...patch, updatedAt: Date.now() });
  };

  const generatePlan = async () => {
    const normalizedGoal = goal.trim();
    if (normalizedGoal.length < 5) {
      setNotice("请把分析目标描述得更具体一些");
      return;
    }
    setPlanning(true);
    setNotice(null);
    try {
      const plan = await createAnalysisPlan(normalizedGoal, accessToken);
      updateProject({
        goal: normalizedGoal,
        title: plan.title,
        plan,
        status: "review",
        runs: plan.steps.map((step) => ({ stepId: step.id, status: "pending", progress: [] })),
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法生成分析计划");
    } finally {
      setPlanning(false);
    }
  };

  const changeStep = (stepId: string, patch: Partial<AnalysisPlanStep>) => {
    if (!project.plan) return;
    updateProject({ plan: { ...project.plan, steps: project.plan.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step) } });
  };

  const removeStep = (stepId: string) => {
    if (!project.plan || project.plan.steps.length <= 2) {
      setNotice("分析计划至少保留两个步骤");
      return;
    }
    updateProject({
      plan: { ...project.plan, steps: project.plan.steps.filter((step) => step.id !== stepId) },
      runs: project.runs.filter((run) => run.stepId !== stepId),
    });
  };

  const addStep = () => {
    if (!project.plan || project.plan.steps.length >= 6) return;
    const id = `custom-${Date.now()}`;
    const step = { id, title: "补充分析", question: "", purpose: "补充验证分析目标中的关键问题。" };
    updateProject({
      plan: { ...project.plan, steps: [...project.plan.steps, step] },
      runs: [...project.runs, { stepId: id, status: "pending", progress: [] }],
    });
  };

  const execute = async (onlyStepId?: string) => {
    if (!project.plan || project.plan.steps.some((step) => step.question.trim().length < 3)) {
      setNotice("请先补全每个步骤的查询问题");
      return;
    }
    const abortController = new AbortController();
    setController(abortController);
    setNotice(null);
    const stepsToRun = onlyStepId
      ? project.plan.steps.filter((step) => step.id === onlyStepId)
      : project.status === "error"
        ? project.plan.steps.filter((step) => runById.get(step.id)?.status === "error")
        : project.plan.steps;
    let working: DataAnalysisProject = {
      ...project,
      status: "running",
      report: onlyStepId || project.status === "error" ? project.report : undefined,
      runs: onlyStepId || project.status === "error"
        ? project.runs.map((run) => stepsToRun.some((step) => step.id === run.stepId) ? { stepId: run.stepId, status: "pending", progress: [] } : run)
        : project.plan.steps.map((step) => ({ stepId: step.id, status: "pending", progress: [] })),
      updatedAt: Date.now(),
    };
    onChange(working);

    try {
      for (const step of stepsToRun) {
        if (abortController.signal.aborted) break;
        const updateRun = (patch: Partial<AnalysisStepRun>) => {
          working = {
            ...working,
            runs: working.runs.map((run) => run.stepId === step.id ? { ...run, ...patch } : run),
            updatedAt: Date.now(),
          };
          onChange(working);
        };
        updateRun({ status: "running", progress: [] });
        await streamQuery(step.question, {
          sessionId: project.id,
          accessToken,
          signal: abortController.signal,
          onEvent: (event) => {
            const current = working.runs.find((run) => run.stepId === step.id)!;
            if (event.type === "progress") updateRun({ progress: upsertProgress(current.progress, event) });
            if (event.type === "result") updateRun({ result: event.data });
            if (event.type === "analysis") updateRun({ analysis: { summary: event.summary, chart: event.chart } });
            if (event.type === "sql") updateRun({ sql: event.sql });
            if (event.type === "error") updateRun({ status: "error", error: event.message });
          },
        });
        const finished = working.runs.find((run) => run.stepId === step.id)!;
        updateRun(finished.error ? { status: "error" } : { status: "done" });
      }
      working = { ...working, status: abortController.signal.aborted ? "review" : working.runs.some((run) => run.status === "error") ? "error" : "complete", updatedAt: Date.now() };
      onChange(working);
      if (working.status === "complete") {
        try {
          const report = await createAnalysisSummary(working, accessToken);
          working = { ...working, report, updatedAt: Date.now() };
          onChange(working);
        } catch {
          setNotice("查询已完成，但综合报告暂时生成失败，可以稍后重新执行生成");
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        working = { ...working, status: "review", runs: working.runs.map((run) => run.status === "running" ? { ...run, status: "pending" } : run), updatedAt: Date.now() };
        onChange(working);
      } else {
        const message = error instanceof Error ? error.message : "分析执行失败";
        working = { ...working, status: "error", runs: working.runs.map((run) => run.status === "running" ? { ...run, status: "error", error: message } : run), updatedAt: Date.now() };
        onChange(working);
        setNotice(message);
      }
    } finally {
      setController(null);
    }
  };

  const skipStep = async (stepId: string) => {
    const runs = project.runs.map((run) => run.stepId === stepId ? { ...run, status: "done" as const, error: undefined } : run);
    const status = runs.some((run) => run.status === "error") ? "error" as const : "complete" as const;
    let nextProject = { ...project, runs, status, updatedAt: Date.now() };
    onChange(nextProject);
    if (status === "complete") {
      try {
        const report = await createAnalysisSummary(nextProject, accessToken);
        nextProject = { ...nextProject, report, updatedAt: Date.now() };
        onChange(nextProject);
      } catch { setNotice("步骤已跳过，但综合报告暂时生成失败"); }
    }
  };

  const exportCsv = () => {
    const cells = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = ["分析步骤,字段,值"];
    for (const step of project.plan?.steps ?? []) {
      const run = project.runs.find((item) => item.stepId === step.id);
      for (const row of normalizeRows(run?.result)) {
        for (const [key, value] of Object.entries(row)) lines.push([step.title, key, value].map(cells).join(","));
      }
    }
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${project.title}-完整数据.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const popup = window.open("", "_blank");
    if (!popup) { setNotice("浏览器阻止了报告窗口，请允许弹出窗口后重试"); return; }
    popup.document.title = `${project.title}-分析报告`;
    const style = popup.document.createElement("style");
    style.textContent = "body{font-family:system-ui,sans-serif;color:#172033;max-width:900px;margin:48px auto;line-height:1.7;padding:0 28px}h1{font-size:28px}h2{margin-top:32px;font-size:18px}li{margin:8px 0}.meta{color:#64748b}.card{border:1px solid #dbe3ef;border-radius:14px;padding:18px;margin:14px 0}@media print{body{margin:0}.no-print{display:none}}";
    popup.document.head.append(style);
    const root = popup.document.createElement("main");
    const addText = (tag: string, text: string, className?: string) => { const node = popup.document.createElement(tag); node.textContent = text; if (className) node.className = className; root.append(node); };
    addText("h1", project.title);
    addText("p", `分析目标：${project.goal}`, "meta");
    addText("h2", "综合结论"); addText("p", project.report?.overview ?? "分析步骤已完成，请结合步骤结果查看。", "card");
    for (const [title, items] of [["关键发现", project.report?.findings], ["行动建议", project.report?.recommendations], ["数据说明", project.report?.cautions]] as const) {
      addText("h2", title); const list = popup.document.createElement("ul"); (items ?? []).forEach((item) => { const li = popup.document.createElement("li"); li.textContent = item; list.append(li); }); root.append(list);
    }
    addText("h2", "分析步骤");
    project.plan?.steps.forEach((step) => { const box = popup.document.createElement("section"); box.className = "card"; const heading = popup.document.createElement("strong"); heading.textContent = step.title; const text = popup.document.createElement("p"); text.textContent = step.question; box.append(heading, text); root.append(box); });
    popup.document.body.append(root); popup.focus(); window.setTimeout(() => popup.print(), 250);
  };

  if (!project.plan || project.status === "draft") {
    return (
      <div className="flex min-h-full items-center justify-center px-5 py-10">
        <section className="w-full max-w-3xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel sm:p-9">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-moss to-brass text-white shadow-lg shadow-moss/20"><Sparkles className="h-5 w-5" /></div>
          <div className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-moss">新数据分析</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">这次希望分析什么？</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">描述业务目标即可。助手只使用当前电商数仓，并先生成计划供你审核，不会立即执行查询。</p>
          <textarea value={goal} onChange={(event) => setGoal(event.target.value)} rows={5} placeholder="例如：分析 2025 年各地区的销售表现，找出增长最快的地区、主要贡献品类和异常月份。" className="mt-6 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm leading-6 outline-none transition focus:border-moss focus:bg-white focus:ring-4 focus:ring-blue-50" />
          {notice && <p className="mt-2 text-xs text-rose-600">{notice}</p>}
          <div className="mt-5 flex justify-end"><button type="button" onClick={generatePlan} disabled={planning} className="inline-flex h-11 items-center gap-2 rounded-xl bg-moss px-5 text-sm font-semibold text-white shadow-lg shadow-moss/20 disabled:opacity-50">{planning ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{planning ? "正在生成计划" : "生成分析计划"}</button></div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-line sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="text-xs font-semibold uppercase tracking-[0.16em] text-moss">{project.status === "complete" ? "分析已完成" : isRunning ? `正在执行 ${completed + 1}/${project.plan.steps.length}` : "分析计划待审核"}</div><h1 className="mt-1 text-xl font-semibold text-ink">{project.plan.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">{project.plan.summary}</p></div>
          <div className="flex gap-2">
            {!isRunning && <button type="button" onClick={() => updateProject({ status: "draft", plan: undefined, runs: [] })} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />修改目标</button>}
            {project.status === "complete" && <><button type="button" onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600"><Download className="h-4 w-4" />完整数据</button><button type="button" onClick={printReport} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm text-slate-600"><FileText className="h-4 w-4" />打印 / PDF</button></>}
            <button type="button" onClick={isRunning ? () => controller?.abort() : () => execute()} className={cn("inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white", isRunning ? "bg-slate-700" : "bg-moss")}>
              {isRunning ? <CircleAlert className="h-4 w-4" /> : project.status === "complete" ? <RotateCcw className="h-4 w-4" /> : <Play className="h-4 w-4" />}{isRunning ? "停止分析" : project.status === "complete" ? "重新执行" : project.status === "error" ? "重试失败步骤" : "确认并执行"}
            </button>
          </div>
        </div>
        {isRunning && <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-moss to-brass transition-all" style={{ width: `${Math.max(6, (completed / project.plan.steps.length) * 100)}%` }} /></div>}
      </section>

      <div className="mt-4 space-y-3">
        {project.plan.steps.map((step, index) => {
          const run = runById.get(step.id);
          const isExpanded = expanded[step.id] ?? Boolean(run?.result);
          return <section key={step.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-line">
            <div className="flex items-start gap-3 p-4 sm:p-5">
              <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-semibold", run?.status === "done" ? "bg-emerald-50 text-emerald-600" : run?.status === "running" ? "bg-blue-50 text-moss" : run?.status === "error" ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500")}>{run?.status === "done" ? <Check className="h-4 w-4" /> : run?.status === "running" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : index + 1}</div>
              <div className="min-w-0 flex-1">
                <input value={step.title} disabled={isRunning} onChange={(event) => changeStep(step.id, { title: event.target.value })} className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none disabled:opacity-100" aria-label={`步骤 ${index + 1} 标题`} />
                <textarea value={step.question} disabled={isRunning} onChange={(event) => changeStep(step.id, { question: event.target.value })} rows={2} className="mt-2 w-full resize-none rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-sm leading-5 text-slate-700 outline-none focus:border-moss disabled:opacity-80" />
                <p className="mt-2 text-xs text-slate-400"><PencilLine className="mr-1 inline h-3 w-3" />{step.purpose}</p>
                {run?.status === "running" && <p className="mt-2 text-xs text-moss">{[...run.progress].reverse().find((item) => item.status === "running")?.step ?? "正在准备查询"}</p>}
                {run?.error && <div className="mt-2 flex items-center gap-3 text-xs text-rose-600"><span>{run.error}</span>{!isRunning && <><button type="button" onClick={() => execute(step.id)} className="font-semibold underline">单独重试</button><button type="button" onClick={() => skipStep(step.id)} className="font-semibold underline">跳过</button></>}</div>}
              </div>
              {!isRunning && project.status !== "complete" && <button type="button" onClick={() => removeStep(step.id)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除步骤"><Trash2 className="h-4 w-4" /></button>}
              {run?.result !== undefined && <button type="button" onClick={() => setExpanded((current) => ({ ...current, [step.id]: !isExpanded }))} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="展开结果">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>}
            </div>
            {isExpanded && run?.result !== undefined && <div className="border-t border-slate-100 bg-slate-50/45 p-4 sm:p-5">{run.analysis && <ResultInsight analysis={run.analysis} data={run.result} />}<ResultTable data={run.result} /></div>}
          </section>;
        })}
      </div>
      {!isRunning && project.status !== "complete" && project.plan.steps.length < 6 && <button type="button" onClick={addStep} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 text-sm text-slate-500 hover:border-moss hover:text-moss"><Plus className="h-4 w-4" />添加分析步骤</button>}
      {notice && <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{notice}</div>}
      {project.status === "complete" && <section className="mt-5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 to-cyan-600 text-white shadow-lg shadow-blue-200"><div className="p-5"><div className="flex items-center gap-2 text-sm font-semibold"><BarChart3 className="h-4 w-4" />综合分析报告</div><p className="mt-3 text-sm leading-6 text-blue-50">{project.report?.overview ?? `已完成 ${completed} 个分析步骤，正在整理综合结论。`}</p></div>{project.report && <div className="grid gap-px bg-white/15 sm:grid-cols-3">{[["关键发现", project.report.findings], ["行动建议", project.report.recommendations], ["数据说明", project.report.cautions]].map(([title, items]) => <div key={title as string} className="bg-blue-700/65 p-5"><div className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100">{title as string}</div><ul className="mt-3 space-y-2 text-xs leading-5 text-blue-50">{(items as string[]).map((item) => <li key={item}>• {item}</li>)}</ul></div>)}</div>}</section>}
    </div>
  );
}
