import type { AnalysisFollowUp, AnalysisPlan, AnalysisReport, DataAnalysisProject } from "../types/analysis";
import { authenticatedFetch } from "./http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function createAnalysisPlan(goal: string, accessToken: string): Promise<AnalysisPlan> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ goal }),
  });
  if (!response.ok) throw new Error(`生成分析计划失败：HTTP ${response.status}`);
  return response.json() as Promise<AnalysisPlan>;
}

export async function createAnalysisSummary(project: DataAnalysisProject, accessToken: string): Promise<AnalysisReport> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      goal: project.goal,
      steps: (project.plan?.steps ?? []).map((step) => {
        const run = project.runs.find((item) => item.stepId === step.id);
        return { id: step.id, title: step.title, question: step.question, result: run?.result, analysis: run?.analysis };
      }),
    }),
  });
  if (!response.ok) throw new Error(`生成综合报告失败：HTTP ${response.status}`);
  return response.json() as Promise<AnalysisReport>;
}

export async function fetchAnalysisProjects(accessToken: string): Promise<DataAnalysisProject[]> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`加载分析项目失败：HTTP ${response.status}`);
  return response.json() as Promise<DataAnalysisProject[]>;
}

export async function saveAnalysisProject(project: DataAnalysisProject, accessToken: string) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${project.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(project),
  });
  if (!response.ok) throw new Error(`保存分析项目失败：HTTP ${response.status}`);
  return response.json() as Promise<DataAnalysisProject>;
}

export async function fetchAnalysisProject(projectId: string, accessToken: string): Promise<DataAnalysisProject> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`刷新分析任务失败：HTTP ${response.status}`);
  return response.json() as Promise<DataAnalysisProject>;
}

export async function runAnalysisProject(projectId: string, accessToken: string, stepId?: string): Promise<DataAnalysisProject> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${projectId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ step_id: stepId ?? null }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `启动分析任务失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<DataAnalysisProject>;
}

export async function stopAnalysisProject(projectId: string, accessToken: string): Promise<DataAnalysisProject> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${projectId}/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`停止分析任务失败：HTTP ${response.status}`);
  return response.json() as Promise<DataAnalysisProject>;
}

export async function askAnalysisFollowUp(projectId: string, question: string, accessToken: string): Promise<Omit<AnalysisFollowUp, "id" | "question" | "createdAt">> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${projectId}/follow-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ question }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `分析追问失败：HTTP ${response.status}`);
  }
  return response.json() as Promise<Omit<AnalysisFollowUp, "id" | "question" | "createdAt">>;
}

export async function deleteAnalysisProject(projectId: string, accessToken: string) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${projectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`删除分析项目失败：HTTP ${response.status}`);
}
