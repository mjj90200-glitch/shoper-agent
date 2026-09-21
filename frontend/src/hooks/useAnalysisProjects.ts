/**
 * 数据分析项目 Hook
 * 管理项目列表、活动项目、本地持久化、服务端双向同步与增删改
 */
import { useCallback, useEffect, useState } from "react";
import {
  ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY,
  ANALYSIS_PROJECTS_STORAGE_KEY,
  WORKSPACE_MODE_STORAGE_KEY,
  loadAnalysisProjects,
  makeId,
  type StoredAuth,
  type WorkspaceMode,
} from "../lib/workspaceStorage";
import { deleteAnalysisProject, fetchAnalysisProjects, saveAnalysisProject } from "../lib/analysisApi";
import type { DataAnalysisProject } from "../types/analysis";

type Notify = (message: string) => void;

export function useAnalysisProjects(options: {
  auth: StoredAuth | null;
  notify: Notify;
  workspaceMode: WorkspaceMode;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
}) {
  const { auth, notify, workspaceMode, setWorkspaceMode } = options;
  const [analysisProjects, setAnalysisProjects] = useState<DataAnalysisProject[]>(loadAnalysisProjects);
  const [activeAnalysisId, setActiveAnalysisId] = useState(
    () => window.localStorage.getItem(ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY) ?? "",
  );
  const [analysisHydrated, setAnalysisHydrated] = useState(false);

  const activeAnalysisProject = analysisProjects.find((item) => item.id === activeAnalysisId);

  // 登录后合并服务端项目（按更新时间取较新的一方）
  useEffect(() => {
    if (!auth) return;
    let cancelled = false;
    void fetchAnalysisProjects(auth.accessToken)
      .then((remoteProjects) => {
        if (cancelled) return;
        setAnalysisProjects((localProjects) => {
          const merged = new Map(localProjects.map((project) => [project.id, project]));
          for (const remote of remoteProjects) {
            const local = merged.get(remote.id);
            if (!local || remote.updatedAt >= local.updatedAt) merged.set(remote.id, remote);
          }
          return [...merged.values()];
        });
      })
      .catch(() => notify("分析项目暂时使用本机记录，服务端稍后自动重试"))
      .finally(() => { if (!cancelled) setAnalysisHydrated(true); });
    return () => { cancelled = true; };
  }, [auth, notify]);

  // 水合完成后把本地项目防抖同步到服务端
  useEffect(() => {
    if (!auth || !analysisHydrated) return;
    const timer = window.setTimeout(() => {
      void Promise.all(analysisProjects.map((project) => saveAnalysisProject(project, auth.accessToken)))
        .catch(() => notify("分析项目尚未同步到服务端，本机内容仍已保留"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [analysisProjects, analysisHydrated, auth]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_MODE_STORAGE_KEY, workspaceMode);
    window.localStorage.setItem(ANALYSIS_PROJECTS_STORAGE_KEY, JSON.stringify(analysisProjects));
    if (activeAnalysisId) {
      window.localStorage.setItem(ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY, activeAnalysisId);
    } else {
      window.localStorage.removeItem(ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY);
    }
  }, [workspaceMode, analysisProjects, activeAnalysisId]);

  const startNewAnalysis = useCallback(() => {
    const now = Date.now();
    const project: DataAnalysisProject = {
      id: makeId(),
      title: `分析项目 ${analysisProjects.length + 1}`,
      goal: "",
      status: "draft",
      runs: [],
      followUps: [],
      createdAt: now,
      updatedAt: now,
    };
    setAnalysisProjects((current) => [project, ...current]);
    setActiveAnalysisId(project.id);
    setWorkspaceMode("analysis");
    return project;
  }, [analysisProjects.length, setWorkspaceMode]);

  const updateAnalysisProject = useCallback((nextProject: DataAnalysisProject) => {
    setAnalysisProjects((current) => current.map((project) => (
      project.id === nextProject.id ? nextProject : project
    )));
  }, []);

  const renameAnalysisProject = useCallback((project: DataAnalysisProject) => {
    const title = window.prompt("设置分析项目名称", project.title)?.trim();
    if (!title || title === project.title) return;
    updateAnalysisProject({ ...project, title: title.slice(0, 80), updatedAt: Date.now() });
  }, [updateAnalysisProject]);

  const removeAnalysisProject = useCallback((projectId: string) => {
    if (!window.confirm("确定删除这个分析项目及其结果吗？")) return;
    setAnalysisProjects((current) => {
      const remaining = current.filter((project) => project.id !== projectId);
      if (projectId === activeAnalysisId) setActiveAnalysisId(remaining[0]?.id ?? "");
      return remaining;
    });
    if (auth) void deleteAnalysisProject(projectId, auth.accessToken)
      .catch(() => notify("服务端删除失败，本机列表已移除"));
  }, [activeAnalysisId, auth, notify]);

  return {
    analysisProjects,
    activeAnalysisId,
    activeAnalysisProject,
    setActiveAnalysisId,
    startNewAnalysis,
    updateAnalysisProject,
    renameAnalysisProject,
    removeAnalysisProject,
  };
}
