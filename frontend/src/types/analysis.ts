import type { ResultAnalysis, StepState } from "./agent";

export type AnalysisPlanStep = {
  id: string;
  title: string;
  question: string;
  purpose: string;
};

export type AnalysisPlan = {
  title: string;
  summary: string;
  steps: AnalysisPlanStep[];
};

export type AnalysisStepRun = {
  stepId: string;
  status: "pending" | "running" | "done" | "error";
  progress: StepState[];
  result?: unknown;
  analysis?: ResultAnalysis;
  sql?: string;
  error?: string;
};

export type DataAnalysisProject = {
  id: string;
  title: string;
  goal: string;
  status: "draft" | "review" | "running" | "complete" | "error";
  plan?: AnalysisPlan;
  runs: AnalysisStepRun[];
  report?: AnalysisReport;
  createdAt: number;
  updatedAt: number;
};

export type AnalysisReport = {
  overview: string;
  findings: string[];
  recommendations: string[];
  cautions: string[];
};
