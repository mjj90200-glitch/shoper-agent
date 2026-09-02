/**
 * 智能体类型定义
 * 定义问数智能体前端使用的 SSE 事件、流程步骤和聊天消息类型
 */
export type ProgressStatus = "running" | "success" | "error";

export type ProgressEvent = {
  type: "progress";
  step: string;
  status: ProgressStatus;
};

export type ResultEvent = {
  type: "result";
  data: unknown;
};

export type QueryContextEvent = {
  type: "query_context";
  original_query: string;
  resolved_query: string;
};

export type SqlEvent = {
  type: "sql";
  sql: string;
};

export type ChartPoint = {
  label: string;
  value: number;
};

export type ChartSpec = {
  type: "bar" | "line";
  label_key: string;
  value_key: string;
  data: ChartPoint[];
  truncated: boolean;
};

export type ResultAnalysis = {
  summary: string;
  chart: ChartSpec | null;
};

export type AnalysisEvent = {
  type: "analysis";
  summary: string;
  chart: ChartSpec | null;
};

export type AssistantMessageEvent = {
  type: "assistant_message";
  category: "non_data";
  message: string;
  suggested_queries: string[];
};

export type ErrorEvent = {
  type: "error";
  message: string;
};

export type AgentEvent =
  | ProgressEvent
  | ResultEvent
  | QueryContextEvent
  | SqlEvent
  | AnalysisEvent
  | AssistantMessageEvent
  | ErrorEvent;

export type StepState = {
  step: string;
  status: ProgressStatus;
  updatedAt: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  status?: "streaming" | "done" | "error";
  steps?: StepState[];
  result?: unknown;
  originalQuery?: string;
  resolvedQuery?: string;
  sql?: string;
  analysis?: ResultAnalysis;
  error?: string;
  category?: AssistantMessageEvent["category"];
  suggestedQueries?: string[];
};
