import type { AnalysisPlan, AnalysisReport, DataAnalysisProject } from "../types/analysis";
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
        return { title: step.title, question: step.question, result: run?.result, analysis: run?.analysis };
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
}

export async function deleteAnalysisProject(projectId: string, accessToken: string) {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/analysis/projects/${projectId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`删除分析项目失败：HTTP ${response.status}`);
}
