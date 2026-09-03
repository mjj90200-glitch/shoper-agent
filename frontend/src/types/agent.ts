/**
 * 智能体类型定义
 * 定义问数智能体前端使用的 SSE 事件、流程步骤和聊天消息类型
 */
export type ProgressStatus = "running" | "success" | "error";

export type CurrentUser = {
  username: string;
  display_name: string;
  role: string;
  allowed_regions: string[];
  masked_fields: string[];
};

export type QueryAudit = {
  id: string;
  session_id: string;
  query: string;
  resolved_query: string | null;
  sql: string | null;
  result_row_count: number | null;
  terminal_type: string | null;
  status: "running" | "succeeded" | "failed";
  error: string | null;
  feedback_score: "up" | "down" | null;
  feedback_comment: string | null;
  feedback_at: string | null;
  started_at: string;
  duration_ms: number | null;
};

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

export type AuditContextEvent = {
  type: "audit_context";
  audit_id: string;
};

export type AgentEvent =
  | ProgressEvent
  | ResultEvent
  | QueryContextEvent
  | SqlEvent
  | AnalysisEvent
  | AssistantMessageEvent
  | AuditContextEvent
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
  auditId?: string;
  feedbackScore?: "up" | "down";
};
