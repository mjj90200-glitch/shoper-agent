/**
 * 前端应用主组件
 * 负责聊天会话状态、SSE 事件消费和整体页面布局
 */
import {
  Activity,
  BarChart3,
  ChartNoAxesCombined,
  ClipboardList,
  FilePlus2,
  Leaf,
  MessagesSquare,
  MessageSquarePlus,
  Pencil,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { AuditPanel } from "./components/AuditPanel";
import { ConversationList } from "./components/ConversationList";
import { EmptyState } from "./components/EmptyState";
import { LoginPanel } from "./components/LoginPanel";
import { MessageBubble } from "./components/MessageBubble";
import { streamQuery } from "./lib/agentApi";
import { deleteAnalysisProject, fetchAnalysisProjects, saveAnalysisProject } from "./lib/analysisApi";
import { AUTH_EXPIRED_EVENT } from "./lib/http";
import { deleteSession, fetchSession, fetchSessions, renameSession } from "./lib/sessionApi";
import { cn, summarizeResult } from "./lib/format";
import type {
  AgentEvent,
  ChatConversation,
  ChatMessage,
  CurrentUser,
  QueryAudit,
  StepState,
} from "./types/agent";
import type { DataAnalysisProject } from "./types/analysis";

const examples = [
  "分析 2025 年第一季度各大区 GMV，对比区域贡献并找出领先市场",
  "展示 2025 年每月销售额趋势，并分析峰值月份",
  "分析各商品品类的销量与销售额，展示品类结构",
  "找出销售额最高的前 10 个商品，并比较头部商品差距",
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "Vite /api proxy";
const LEGACY_CONVERSATION_STORAGE_KEY = "shopkeeper-agent:active-conversation";
const CONVERSATIONS_STORAGE_KEY = "shopkeeper-agent:conversations";
const ACTIVE_CONVERSATION_STORAGE_KEY = "shopkeeper-agent:active-conversation-id";
const AUTH_STORAGE_KEY = "shopkeeper-agent:demo-auth";
const FLOW_VISIBILITY_STORAGE_KEY = "shopkeeper-agent:show-analysis-flow";
const WORKSPACE_MODE_STORAGE_KEY = "shopkeeper-agent:workspace-mode";
const ANALYSIS_PROJECTS_STORAGE_KEY = "shopkeeper-agent:analysis-projects";
const ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY = "shopkeeper-agent:active-analysis-project-id";

type WorkspaceMode = "ask" | "analysis";

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createConversation(title = "新分析"): ChatConversation {
  const now = Date.now();
  return {
    sessionId: makeId(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function deriveConversationTitle(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim();
  return normalized.length > 28 ? `${normalized.slice(0, 28)}…` : normalized;
}

function loadConversationWorkspace(): {
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

function recordsToMessages(records: QueryAudit[]): ChatMessage[] {
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

type StoredAuth = { accessToken: string; user: CurrentUser };

function loadAuth(): StoredAuth | null {
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

function loadFlowVisibility() {
  return window.localStorage.getItem(FLOW_VISIBILITY_STORAGE_KEY) !== "false";
}

function loadWorkspaceMode(): WorkspaceMode {
  return window.localStorage.getItem(WORKSPACE_MODE_STORAGE_KEY) === "analysis" ? "analysis" : "ask";
}

function loadAnalysisProjects(): DataAnalysisProject[] {
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

function upsertStep(steps: StepState[] = [], event: Extract<AgentEvent, { type: "progress" }>) {
  const next = steps.filter((item) => item.step !== event.step);
  next.push({
    step: event.step,
    status: event.status,
    updatedAt: Date.now(),
  });
  return next;
}

export default function App() {
  const [auth, setAuth] = useState<StoredAuth | null>(loadAuth);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(loadWorkspaceMode);
  const [analysisProjects, setAnalysisProjects] = useState<DataAnalysisProject[]>(loadAnalysisProjects);
  const [activeAnalysisId, setActiveAnalysisId] = useState(
    () => window.localStorage.getItem(ACTIVE_ANALYSIS_PROJECT_STORAGE_KEY) ?? "",
  );
  const [analysisHydrated, setAnalysisHydrated] = useState(false);
  const [initialWorkspace] = useState(loadConversationWorkspace);
  const [conversations, setConversations] = useState<ChatConversation[]>(
    initialWorkspace.conversations,
  );
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState(initialWorkspace.activeSessionId);
  const [activeController, setActiveController] = useState<AbortController | null>(null);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const [showFlow, setShowFlow] = useState(loadFlowVisibility);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const conversationsRef = useRef(conversations);

  const activeConversation = conversations.find((item) => item.sessionId === sessionId)
    ?? conversations[0];
  const messages = activeConversation?.messages ?? [];
  const sortedConversations = useMemo(
    () => [...conversations].sort((left, right) => right.updatedAt - left.updatedAt),
    [conversations],
  );
  const activeAnalysisProject = analysisProjects.find((item) => item.id === activeAnalysisId);

  const setMessages = (
    updater: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[]),
  ) => {
    setConversations((current) => current.map((conversation) => {
      if (conversation.sessionId !== sessionId) return conversation;
      const nextMessages = typeof updater === "function"
        ? updater(conversation.messages)
        : updater;
      return { ...conversation, messages: nextMessages, updatedAt: Date.now() };
    }));
  };

  const isStreaming = Boolean(activeController);
  const canSubmit = draft.trim().length > 0 && !isStreaming;

  const completedCount = useMemo(
    () => messages.filter((message) => message.role === "assistant" && message.status === "done").length,
    [messages],
  );
  const activeStep = useMemo(() => {
    const assistant = [...messages].reverse().find((message) => message.role === "assistant" && message.status === "streaming");
    return [...(assistant?.steps ?? [])].reverse().find((step) => step.status === "running")?.step
      ?? assistant?.steps?.at(-1)?.step;
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    conversationsRef.current = conversations;
    try {
      window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, sessionId);
      window.localStorage.removeItem(LEGACY_CONVERSATION_STORAGE_KEY);
    } catch {
      setComposerNotice("本地会话空间已满，新内容暂时无法持久保存");
    }
  }, [conversations, sessionId]);

  useEffect(() => {
    if (conversations.length === 0 || conversations.some((item) => item.sessionId === sessionId)) {
      return;
    }
    const newest = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    setSessionId(newest.sessionId);
  }, [conversations, sessionId]);

  useEffect(() => {
    if (!auth) return;
    let cancelled = false;

    void fetchSessions(auth.accessToken)
      .then((remoteSessions) => {
        if (cancelled) return;
        setConversations((current) => {
          const next = [...current];
          for (const remote of remoteSessions) {
            const index = next.findIndex((item) => item.sessionId === remote.session_id);
            const createdAt = Date.parse(remote.created_at);
            const updatedAt = Date.parse(remote.updated_at);
            if (index >= 0) {
              next[index] = {
                ...next[index],
                remote: true,
                title: next[index].customTitle ? next[index].title : remote.title,
                createdAt: Number.isNaN(createdAt) ? next[index].createdAt : createdAt,
                updatedAt: Number.isNaN(updatedAt)
                  ? next[index].updatedAt
                  : Math.max(next[index].updatedAt, updatedAt),
              };
            } else {
              next.push({
                sessionId: remote.session_id,
                title: remote.title,
                messages: [],
                createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
                updatedAt: Number.isNaN(updatedAt) ? Date.now() : updatedAt,
                remote: true,
              });
            }
          }
          return next;
        });
      })
      .catch(() => {
        // 本地会话仍然可用，服务端历史将在下次加载时重试。
      });

    return () => {
      cancelled = true;
    };
  }, [auth]);

  useEffect(() => {
    window.localStorage.setItem(FLOW_VISIBILITY_STORAGE_KEY, String(showFlow));
  }, [showFlow]);

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
      .catch(() => setComposerNotice("分析项目暂时使用本机记录，服务端稍后自动重试"))
      .finally(() => { if (!cancelled) setAnalysisHydrated(true); });
    return () => { cancelled = true; };
  }, [auth]);

  useEffect(() => {
    if (!auth || !analysisHydrated) return;
    const timer = window.setTimeout(() => {
      void Promise.all(analysisProjects.map((project) => saveAnalysisProject(project, auth.accessToken)))
        .catch(() => setComposerNotice("分析项目尚未同步到服务端，本机内容仍已保留"));
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

  useEffect(() => {
    const handleAuthExpired = () => {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      setActiveController((current) => {
        current?.abort();
        return null;
      });
      setAuth(null);
      setLoginNotice("登录状态已过期，请重新登录。原请求未执行。");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    if (auth && auth.accessToken.split(".").length !== 2) handleAuthExpired();
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [auth]);

  useEffect(() => {
    if (!composerNotice) return;
    const timer = window.setTimeout(() => setComposerNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [composerNotice]);

  const startQuery = async (rawQuery = draft) => {
    const query = rawQuery.trim();
    if (!query || isStreaming || !auth) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      role: "user",
      content: query,
      createdAt: Date.now(),
    };

    const assistantId = makeId();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "正在连接问数智能体...",
      createdAt: Date.now(),
      status: "streaming",
      steps: [],
    };

    const controller = new AbortController();
    setActiveController(controller);
    setDraft("");
    setConversations((current) => current.map((conversation) => (
      conversation.sessionId === sessionId
      && !conversation.customTitle
      && conversation.messages.length === 0
        ? { ...conversation, title: deriveConversationTitle(query), updatedAt: Date.now() }
        : conversation
    )));
    setMessages((current) => [...current, userMessage, assistantMessage]);

    const onEvent = (event: AgentEvent) => {
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== assistantId) return message;

          if (event.type === "progress") {
            return {
              ...message,
              content: event.status === "running" ? `正在执行：${event.step}` : message.content,
              steps: upsertStep(message.steps, event),
            };
          }

          if (event.type === "audit_context") {
            return { ...message, auditId: event.audit_id };
          }

          if (event.type === "result") {
            return {
              ...message,
              status: "done",
              content: summarizeResult(event.data),
              result: event.data,
            };
          }

          if (event.type === "query_context") {
            return {
              ...message,
              originalQuery: event.original_query,
              resolvedQuery: event.resolved_query,
            };
          }

          if (event.type === "sql") {
            return { ...message, sql: event.sql };
          }

          if (event.type === "analysis") {
            return { ...message, analysis: { summary: event.summary, chart: event.chart } };
          }

          if (event.type === "assistant_message") {
            return {
              ...message,
              status: "done",
              content: event.message,
              category: event.category,
              suggestedQueries: event.suggested_queries,
            };
          }

          return {
            ...message,
            status: "error",
            content: "这次查询没有成功。",
            error: event.message,
          };
        }),
      );
    };

    try {
      await streamQuery(query, {
        sessionId,
        accessToken: auth.accessToken,
        signal: controller.signal,
        onEvent,
      });
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId && message.status === "streaming"
            ? { ...message, status: "done", content: "流程已结束，后端未返回查询结果。" }
            : message,
        ),
      );
      setConversations((current) => current.map((conversation) => (
        conversation.sessionId === sessionId
          ? { ...conversation, remote: true }
          : conversation
      )));
      const savedConversation = conversationsRef.current.find(
        (conversation) => conversation.sessionId === sessionId,
      );
      if (savedConversation?.customTitle) {
        void renameSession(sessionId, savedConversation.title, auth.accessToken).catch(() => {
          setComposerNotice("会话名称已保存在本机，服务端同步将在下次重试");
        });
      }
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                status: isAbort ? "done" : "error",
                content: isAbort ? "已停止本次查询。" : "无法连接问数接口。",
                error: isAbort ? undefined : error instanceof Error ? error.message : String(error),
              }
            : message,
        ),
      );
    } finally {
      setActiveController((current) => current === controller ? null : current);
    }
  };

  const stopQuery = () => {
    activeController?.abort();
  };

  const startNewConversation = () => {
    activeController?.abort();
    setActiveController(null);
    const nextConversation = createConversation();
    setConversations((current) => [nextConversation, ...current]);
    setDraft("");
    setSessionId(nextConversation.sessionId);
    setIsAuditOpen(false);
    setIsSessionsOpen(false);
    setComposerNotice("新问数已创建，可以开始提问");
    setFocusSignal((value) => value + 1);
  };

  const handleLoggedIn = (nextAuth: StoredAuth) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
    setAuth(nextAuth);
    setDraft("");
    setLoginNotice(null);
  };

  const startNewAnalysis = () => {
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
    setIsSessionsOpen(false);
  };

  const updateAnalysisProject = (nextProject: DataAnalysisProject) => {
    setAnalysisProjects((current) => current.map((project) => (
      project.id === nextProject.id ? nextProject : project
    )));
  };

  const renameAnalysisProject = (project: DataAnalysisProject) => {
    const title = window.prompt("设置分析项目名称", project.title)?.trim();
    if (!title || title === project.title) return;
    updateAnalysisProject({ ...project, title: title.slice(0, 80), updatedAt: Date.now() });
  };

  const removeAnalysisProject = (projectId: string) => {
    if (!window.confirm("确定删除这个分析项目及其结果吗？")) return;
    setAnalysisProjects((current) => {
      const remaining = current.filter((project) => project.id !== projectId);
      if (projectId === activeAnalysisId) setActiveAnalysisId(remaining[0]?.id ?? "");
      return remaining;
    });
    if (auth) void deleteAnalysisProject(projectId, auth.accessToken)
      .catch(() => setComposerNotice("服务端删除失败，本机列表已移除"));
  };

  const switchWorkspaceMode = (mode: WorkspaceMode) => {
    if (isStreaming || mode === workspaceMode) return;
    setWorkspaceMode(mode);
    setIsAuditOpen(false);
    setIsSessionsOpen(false);
  };

  const logout = () => {
    if (isStreaming) return;
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    setDraft("");
    setAuth(null);
    setLoginNotice(null);
  };

  const selectConversation = (nextSessionId: string) => {
    if (!auth) return;
    if (nextSessionId === sessionId) {
      setIsSessionsOpen(false);
      return;
    }

    activeController?.abort();
    setActiveController(null);
    setDraft("");
    setSessionId(nextSessionId);
    setIsSessionsOpen(false);
    setFocusSignal((value) => value + 1);

    const selected = conversations.find((item) => item.sessionId === nextSessionId);
    if (!selected || selected.messages.length > 0 || !selected.remote) return;

    setLoadingSessionId(nextSessionId);
    void fetchSession(nextSessionId, auth.accessToken)
      .then((records) => {
        setConversations((current) => current.map((conversation) => (
          conversation.sessionId === nextSessionId
            ? { ...conversation, messages: recordsToMessages(records) }
            : conversation
        )));
      })
      .catch(() => setComposerNotice("暂时无法加载这个历史会话"))
      .finally(() => setLoadingSessionId((current) => (
        current === nextSessionId ? null : current
      )));
  };

  const renameConversation = (targetSessionId: string, title: string) => {
    const selected = conversations.find((item) => item.sessionId === targetSessionId);
    setConversations((current) => current.map((conversation) => (
      conversation.sessionId === targetSessionId
        ? { ...conversation, title, customTitle: true, updatedAt: Date.now() }
        : conversation
    )));

    if (selected?.remote && auth) {
      void renameSession(targetSessionId, title, auth.accessToken)
        .catch(() => setComposerNotice("会话名称已保存在本机，服务端同步将在下次重试"));
    }
  };

  const removeConversation = async (targetSessionId: string) => {
    const selected = conversationsRef.current.find(
      (conversation) => conversation.sessionId === targetSessionId,
    );
    if (!selected) return;

    if (selected.remote && auth) {
      try {
        await deleteSession(targetSessionId, auth.accessToken);
      } catch {
        setComposerNotice("删除失败，会话内容仍然保留");
        return;
      }
    }

    if (targetSessionId === sessionId) {
      activeController?.abort();
      setActiveController(null);
      setDraft("");
    }
    setLoadingSessionId((current) => current === targetSessionId ? null : current);
    setConversations((current) => {
      const remaining = current.filter(
        (conversation) => conversation.sessionId !== targetSessionId,
      );
      return remaining.length > 0 ? remaining : [createConversation()];
    });
    setComposerNotice("会话已删除");
  };

  if (!auth) {
    return <LoginPanel onLoggedIn={handleLoggedIn} notice={loginNotice} />;
  }

  return (
    <div className="h-dvh overflow-hidden bg-parchment text-ink">
      <div className="pointer-events-none fixed inset-0 grain" />

      <div className="relative grid h-full min-h-0 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 bg-soot text-white lg:flex lg:flex-col">
          <div className="border-b border-white/10 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-moss to-brass text-white shadow-lg shadow-moss/20">
                <BarChart3 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-[0.01em] text-white">AI数分助手</div>
                <div className="text-xs text-slate-400">AI data analyst</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
              {([
                { mode: "ask" as const, label: "问数", icon: MessagesSquare },
                { mode: "analysis" as const, label: "数据分析", icon: ChartNoAxesCombined },
              ]).map(({ mode, label, icon: Icon }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => switchWorkspaceMode(mode)}
                  disabled={isStreaming}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition",
                    workspaceMode === mode
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-400 hover:bg-white/5 hover:text-white",
                    isStreaming && "cursor-not-allowed opacity-50",
                  )}
                  title={isStreaming ? "请等待当前问数完成" : `切换到${label}`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4">
            <button
              type="button"
              onClick={workspaceMode === "ask" ? startNewConversation : startNewAnalysis}
              className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-moss text-sm font-semibold text-white shadow-lg shadow-moss/20 transition hover:bg-blue-500"
            >
              {workspaceMode === "ask" ? (
                <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              ) : (
                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
              )}
              {workspaceMode === "ask" ? "新问数" : "新建分析"}
            </button>

            <section className="flex min-h-0 flex-1 flex-col">
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {workspaceMode === "ask" ? "问数会话" : "分析项目"}
                </div>
                <div className="text-[11px] text-slate-500">
                  {workspaceMode === "ask" ? conversations.length : analysisProjects.length}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                {workspaceMode === "ask" ? (
                  <ConversationList
                    conversations={sortedConversations}
                    activeId={sessionId}
                    loadingId={loadingSessionId}
                    variant="dark"
                    onSelect={selectConversation}
                    onRename={renameConversation}
                    onDelete={removeConversation}
                  />
                ) : analysisProjects.length > 0 ? (
                  <div className="space-y-1">
                    {[...analysisProjects].sort((left, right) => right.updatedAt - left.updatedAt).map((project) => (
                      <div
                        key={project.id}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition",
                          project.id === activeAnalysisId
                            ? "bg-white/10 text-white"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                        )}
                      >
                        <ChartNoAxesCombined className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <button type="button" onClick={() => setActiveAnalysisId(project.id)} className="min-w-0 flex-1 truncate text-left">{project.title}</button>
                        {project.status === "running" && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}
                        <button type="button" onClick={() => renameAnalysisProject(project)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-55 hover:bg-white/10 hover:opacity-100" aria-label="重命名分析项目"><Pencil className="h-3 w-3" /></button>
                        <button type="button" onClick={() => removeAnalysisProject(project.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-55 hover:bg-rose-500/20 hover:text-rose-300 hover:opacity-100" aria-label="删除分析项目"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs leading-5 text-slate-500">
                    暂无分析项目
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="border-t border-white/10 p-4">
            <div className="grid gap-2 text-xs text-slate-400">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2">
                  <Server className="h-3.5 w-3.5" aria-hidden="true" />
                  API
                </span>
                <span className="truncate font-mono">{API_BASE_URL}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2">
                  <Activity className="h-3.5 w-3.5" aria-hidden="true" />
                  {workspaceMode === "ask" ? "完成问数" : "分析项目"}
                </span>
                <span className="font-semibold text-slate-200">
                  {workspaceMode === "ask" ? completedCount : analysisProjects.length}
                </span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-xl lg:px-7">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-moss to-brass text-white lg:hidden">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">
                  {workspaceMode === "ask"
                    ? activeConversation?.title ?? "问数工作台"
                    : activeAnalysisProject?.title ?? "数据分析工作台"}
                </div>
                <div className="truncate text-xs text-slate-500">
                  {workspaceMode === "ask" ? "快速问数 · 实时回答" : "制定计划 · 审核步骤 · 生成洞察"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => switchWorkspaceMode(workspaceMode === "ask" ? "analysis" : "ask")}
                disabled={isStreaming}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-50 px-2.5 text-xs font-semibold text-moss transition hover:bg-blue-100 disabled:opacity-40 lg:hidden"
                aria-label={workspaceMode === "ask" ? "切换到数据分析" : "切换到问数"}
              >
                {workspaceMode === "ask" ? <ChartNoAxesCombined className="h-3.5 w-3.5" /> : <MessagesSquare className="h-3.5 w-3.5" />}
                {workspaceMode === "ask" ? "数据分析" : "问数"}
              </button>
              <span className="hidden text-right text-xs text-slate-500 sm:block">
                <span className="block font-semibold text-slate-700">{auth.user.display_name}</span>
                <span>{auth.user.role}</span>
              </span>
              <button
                type="button"
                onClick={logout}
                disabled={isStreaming}
                className="px-2 py-1 text-xs text-slate-500 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
              >
                退出
              </button>
              <button
                type="button"
                onClick={() => setIsSessionsOpen(true)}
                className="px-2 py-1 text-xs text-slate-500 hover:text-slate-900 lg:hidden"
              >
                {workspaceMode === "ask" ? "会话" : "项目"}
              </button>
              {workspaceMode === "ask" && <button
                type="button"
                onClick={() => setIsAuditOpen(true)}
                disabled={isStreaming}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                title="查询审计"
                aria-label="查询审计"
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
              </button>}
              <button
                type="button"
                onClick={workspaceMode === "ask" ? startNewConversation : startNewAnalysis}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-blue-50 hover:text-moss",
                )}
                title={workspaceMode === "ask" ? "新问数" : "新建分析"}
                aria-label={workspaceMode === "ask" ? "新问数" : "新建分析"}
              >
                {workspaceMode === "ask" ? (
                  <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </header>

          {workspaceMode === "ask" ? <><div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {messages.length === 0 ? (
              <EmptyState examples={examples} onUseExample={(example) => setDraft(example)} />
            ) : (
              <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-7 lg:px-8">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onUseSuggestion={startQuery}
                    accessToken={auth.accessToken}
                    showFlow={showFlow}
                    onFeedbackSaved={(score) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, feedbackScore: score } : item))}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200/70 bg-white/55 px-4 py-2 text-center text-xs text-slate-400">
            <span className="inline-flex items-center gap-2">
              <Leaf className="h-3.5 w-3.5 text-brass" aria-hidden="true" />
              {isStreaming ? "运行中" : "就绪"}
            </span>
          </div>
          <Composer
            value={draft}
            disabled={!canSubmit}
            isStreaming={isStreaming}
            onChange={setDraft}
            onSubmit={() => startQuery()}
            onStop={stopQuery}
            showFlow={showFlow}
            onToggleFlow={() => setShowFlow((value) => !value)}
            activeStep={activeStep}
            notice={composerNotice}
            focusSignal={focusSignal}
          />
          </> : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {activeAnalysisProject ? (
                <AnalysisWorkspace
                  key={activeAnalysisProject.id}
                  project={activeAnalysisProject}
                  accessToken={auth.accessToken}
                  onChange={updateAnalysisProject}
                />
              ) : (
                <div className="flex min-h-full items-center justify-center p-6 text-center">
                  <div><ChartNoAxesCombined className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm text-slate-500">新建一个分析项目开始工作</p><button type="button" onClick={startNewAnalysis} className="mt-4 rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white">新建分析项目</button></div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      {workspaceMode === "ask" && isAuditOpen && <AuditPanel accessToken={auth.accessToken} isAdmin={auth.user.role === "admin"} onClose={() => setIsAuditOpen(false)} />}
      {isSessionsOpen && (
        <div className="fixed inset-0 z-20 bg-slate-950/45 p-4 backdrop-blur-sm sm:p-8 lg:hidden">
          <section className="ml-auto flex h-full w-full max-w-sm flex-col rounded-3xl bg-white p-5 shadow-panel">
            <header className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <h2 className="font-semibold text-ink">{workspaceMode === "ask" ? "问数会话" : "分析项目"}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {workspaceMode === "ask" ? "切换或管理问数会话" : "切换数据分析项目"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsSessionsOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                aria-label="关闭会话列表"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>
            <button
              type="button"
              onClick={workspaceMode === "ask" ? startNewConversation : startNewAnalysis}
              className="mb-4 flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-moss text-sm font-semibold text-white shadow-lg shadow-moss/15"
            >
              {workspaceMode === "ask" ? <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
              {workspaceMode === "ask" ? "新问数" : "新建分析"}
            </button>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {workspaceMode === "ask" ? <ConversationList
                conversations={sortedConversations}
                activeId={sessionId}
                loadingId={loadingSessionId}
                onSelect={selectConversation}
                onRename={renameConversation}
                onDelete={removeConversation}
              /> : analysisProjects.length > 0 ? (
                <div className="space-y-1">
                  {[...analysisProjects].sort((left, right) => right.updatedAt - left.updatedAt).map((project) => (
                    <div key={project.id} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm", project.id === activeAnalysisId ? "bg-blue-50 text-moss" : "text-slate-600 hover:bg-slate-50")}>
                      <ChartNoAxesCombined className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <button type="button" onClick={() => { setActiveAnalysisId(project.id); setIsSessionsOpen(false); }} className="min-w-0 flex-1 truncate text-left">{project.title}</button>
                      <button type="button" onClick={() => renameAnalysisProject(project)} aria-label="重命名分析项目"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => removeAnalysisProject(project.id)} className="text-rose-500" aria-label="删除分析项目"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
              ) : <div className="py-8 text-center text-sm text-slate-400">暂无分析项目</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
