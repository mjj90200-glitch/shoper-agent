/**
 * 工作区本地存储与纯函数辅助
 * 会话/分析项目的本地加载、迁移和构造逻辑，全部是可独立测试的纯函数
 */
import type {
  ChatConversation,
  ChatMessage,
  CurrentUser,
  QueryAudit,
} from "../types/agent";
import type { DataAnalysisProject } from "../types/analysis";

export const examples = [
  "分析 2025 年第一季度各大区 GMV，对比区域贡献并找出领先市场",
  "展示 2025 年每月销售额趋势，并分析峰值月份",
  "分析各商品品类的销量与销售额，展示品类结构",
  "找出销售额最高的前 10 个商品，并比较头部商品差距",
];

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "Vite /api proxy";
export const LEGACY_CONVERSATION_STORAGE_KEY = "shopkeeper-agent:active-conversation";
export const CONVERSATIONS_STORAGE_KEY = "shopkeeper-agent:conversations";
export const ACTIVE_CONVERSATION_STORAGE_KEY = "shopkeeper-agent:active-conversation-id";
export const AUTH_STORAGE_KEY = "shopkeeper-agent:demo-auth";
export const FLOW_VISIBILITY_STORAGE_KEY = "shopkeeper-agent:show-analysis-flow";
export const WORKSPACE_MODE_STORAGE_KEY = "shopkeeper-agent:workspace-mode";
export const ANALYSIS_PROJECTS_STORAGE_KEY = "shopkeeper-agent:analysis-projects";
export const ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY = "shopkeeper-agent:active-analysis-project-id";

export type WorkspaceMode = "ask" | "analysis";
export type StoredAuth = { accessToken: string; user: CurrentUser };

export function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createConversation(title = "新分析"): ChatConversation {
  const now = Date.now();
  return {
    sessionId: makeId(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function deriveConversationTitle(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim();
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}

export function loadConversationWorkspace(): {
  conversations: ChatConversation[];
  activeSessionId: string;
} {
  const fallback = createConversation();
  try {
    const saved = window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as ChatConversation[];
      const conversations = Array.isArray(parsed)
        ? parsed.filter((item) => typeof item?.sessionId === "string" && Array.isArray(item.messages))
        : [];
      if (conversations.length > 0) {
        const requestedActiveId = window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
        const activeSessionId = conversations.some((item) => item.sessionId === requestedActiveId)
          ? requestedActiveId!
          : conversations[0].sessionId;
        return { conversations, activeSessionId };
      }
    }

    const legacy = window.localStorage.getItem(LEGACY_CONVERSATION_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy) as { messages?: ChatMessage[]; sessionId?: string };
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const firstQuestion = messages.find((message) => message.role === "user")?.content;
      const migrated: ChatConversation = {
        ...fallback,
        sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : fallback.sessionId,
        title: firstQuestion ? deriveConversationTitle(firstQuestion) : fallback.title,
        messages,
        updatedAt: messages.at(-1)?.createdAt ?? fallback.updatedAt,
      };
      return { conversations: [migrated], activeSessionId: migrated.sessionId };
    }
  } catch {
    // 使用空白工作区兜底，避免损坏的本地数据阻塞登录。
  }
  return { conversations: [fallback], activeSessionId: fallback.sessionId };
}

export function recordsToMessages(records: QueryAudit[]): ChatMessage[] {
  return records.flatMap((record) => [
    {
      id: `${record.id}-user`,
      role: "user" as const,
      content: record.query,
      createdAt: Date.parse(record.started_at),
    },
    {
      id: `${record.id}-assistant`,
      role: "assistant" as const,
      content:
        record.error
        || (record.result_row_count !== null
          ? `已返回 ${record.result_row_count} 行结果`
          : "已完成处理"),
      createdAt: Date.parse(record.started_at),
      status: record.status === "failed" ? "error" as const : "done" as const,
      sql: record.sql ?? undefined,
      resolvedQuery: record.resolved_query ?? undefined,
      error: record.error ?? undefined,
    },
  ]);
}

export function loadAuth(): StoredAuth | null {
  try {
    const saved = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<StoredAuth>;
    if (typeof parsed.accessToken !== "string" || !parsed.user) return null;
    return { accessToken: parsed.accessToken, user: parsed.user };
  } catch {
    return null;
  }
}

export function loadFlowVisibility() {
  return window.localStorage.getItem(FLOW_VISIBILITY_STORAGE_KEY) !== "false";
}

export function loadWorkspaceMode(): WorkspaceMode {
  return window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY) === "analysis" ? "analysis" : "ask";
}

export function loadAnalysisProjects(): DataAnalysisProject[] {
  try {
    const saved = window.localStorage.getItem(ANALYSIS_PROJECTS_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) as Partial<DataAnalysisProject>[] : [];
    return Array.isArray(parsed)
      ? parsed
        .filter((item) => typeof item?.id === "string" && typeof item?.title === "string")
        .map((item) => ({
          id: item.id!,
          title: item.title!,
          goal: typeof item.goal === "string" ? item.goal : "",
          status: item.status ?? "draft",
          plan: item.plan,
          runs: Array.isArray(item.runs) ? item.runs : [],
          report: item.report,
          followUps: Array.isArray(item.followUps) ? item.followUps : [],
          createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
          updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : item.createdAt ?? Date.now(),
        }))
      : [];
  } catch {
    return [];
  }
}
