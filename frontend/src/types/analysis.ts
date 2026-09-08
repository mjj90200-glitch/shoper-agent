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
  auditId?: string;
};

export type AnalysisEvidence = {
  finding: string;
  step_ids: string[];
  data_points: string[];
};

export type AnalysisFollowUp = {
  id: string;
  question: string;
  answer: string;
  step_ids: string[];
  caution?: string | null;
  createdAt: number;
};

export type DataAnalysisProject = {
  id: string;
  title: string;
  goal: string;
  status: "draft" | "review" | "running" | "complete" | "error";
  plan?: AnalysisPlan;
  runs: AnalysisStepRun[];
  report?: AnalysisReport;
  followUps?: AnalysisFollowUp[];
  createdAt: number;
  updatedAt: number;
};

export type AnalysisReport = {
  overview: string;
  findings: string[];
  recommendations: string[];
  cautions: string[];
  evidence?: AnalysisEvidence[];
};
