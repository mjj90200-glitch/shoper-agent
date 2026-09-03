/**
 * 前端应用主组件
 * 负责聊天会话状态、SSE 事件消费和整体页面布局
 */
import {
  Activity,
  BarChart3,
  ClipboardList,
  Eraser,
  History,
  Leaf,
  MessageSquarePlus,
  Server,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { AuditPanel } from "./components/AuditPanel";
import { SessionPanel } from "./components/SessionPanel";
import { EmptyState } from "./components/EmptyState";
import { LoginPanel } from "./components/LoginPanel";
import { MessageBubble } from "./components/MessageBubble";
import { streamQuery } from "./lib/agentApi";
import { cn, summarizeResult } from "./lib/format";
import type { AgentEvent, ChatMessage, CurrentUser, StepState } from "./types/agent";

const examples = [
  "统计 2025 年第一季度各大区的 GMV，并按 GMV 从高到低排序",
  "统计 2025 年 3 月各商品品类的销量和销售额",
  "查询华东地区 2025 年第一季度销售额最高的前 5 个商品",
  "按会员等级统计 2025 年第一季度的订单数和销售额",
];

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "Vite /api proxy";
const CONVERSATION_STORAGE_KEY = "shopkeeper-agent:active-conversation";
const AUTH_STORAGE_KEY = "shopkeeper-agent:demo-auth";

function makeId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadConversation(): { messages: ChatMessage[]; sessionId: string } {
  const fallback = { messages: [], sessionId: makeId() };
  try {
    const saved = window.localStorage.getItem(CONVERSATION_STORAGE_KEY);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved) as Partial<typeof fallback>;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : fallback.sessionId,
    };
  } catch {
    return fallback;
  }
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
  const [initialConversation] = useState(loadConversation);
  const [messages, setMessages] = useState<ChatMessage[]>(initialConversation.messages);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState(initialConversation.sessionId);
  const [activeController, setActiveController] = useState<AbortController | null>(null);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isStreaming = Boolean(activeController);
  const canSubmit = draft.trim().length > 0 && !isStreaming;

  const completedCount = useMemo(
    () => messages.filter((message) => message.role === "assistant" && message.status === "done").length,
    [messages],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (isStreaming) return;
    window.localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify({ messages, sessionId }),
    );
  }, [isStreaming, messages, sessionId]);

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
      setActiveController(null);
    }
  };

  const stopQuery = () => {
    activeController?.abort();
  };

  const clearConversation = () => {
    if (isStreaming) return;
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    setMessages([]);
    setDraft("");
    setSessionId(makeId());
  };

  const handleLoggedIn = (nextAuth: StoredAuth) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    setAuth(nextAuth);
    setMessages([]);
    setDraft("");
    setSessionId(makeId());
  };

  const logout = () => {
    if (isStreaming) return;
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    setMessages([]);
    setDraft("");
    setSessionId(makeId());
    setAuth(null);
  };

  const restoreSession = (item: { session_id: string }, records: import("./types/agent").QueryAudit[]) => {
    setSessionId(item.session_id);
    setMessages(records.flatMap((record) => [
      { id: `${record.id}-user`, role: "user" as const, content: record.query, createdAt: Date.parse(record.started_at) },
      { id: `${record.id}-assistant`, role: "assistant" as const, content: record.error || (record.result_row_count !== null ? `已返回 ${record.result_row_count} 行结果` : "已完成处理"), createdAt: Date.parse(record.started_at), status: record.status === "failed" ? "error" as const : "done" as const, sql: record.sql ?? undefined, resolvedQuery: record.resolved_query ?? undefined, error: record.error ?? undefined },
    ]));
    setIsSessionsOpen(false);
  };

  if (!auth) {
    return <LoginPanel onLoggedIn={handleLoggedIn} />;
  }

  return (
    <div className="h-dvh overflow-hidden bg-parchment text-ink">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(90deg,rgba(32,32,29,0.045)_1px,transparent_1px),linear-gradient(rgba(32,32,29,0.035)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="pointer-events-none fixed inset-0 grain" />

      <div className="relative grid h-full min-h-0 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-ink/10 bg-[#efe6d8]/85 backdrop-blur lg:flex lg:flex-col">
          <div className="border-b border-ink/10 px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center bg-ink text-parchment">
                <BarChart3 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="text-base font-semibold tracking-[0.02em]">电商问数</div>
                <div className="text-xs text-ink/50">shopkeeper-agent</div>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
            <button
              type="button"
              onClick={clearConversation}
              disabled={isStreaming}
              className="flex h-11 w-full items-center justify-center gap-2 bg-ink text-sm font-semibold text-parchment transition hover:bg-soot disabled:cursor-not-allowed disabled:bg-ink/35"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              新会话
            </button>

            <section>
              <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">
                <History className="h-3.5 w-3.5" aria-hidden="true" />
                样例
              </div>
              <div className="space-y-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => startQuery(example)}
                    className="w-full border border-ink/10 bg-white/42 px-3 py-3 text-left text-sm leading-5 text-ink/75 transition hover:border-moss/35 hover:bg-white/75 disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="border-t border-ink/10 p-4">
            <div className="grid gap-2 text-xs text-ink/55">
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
                  完成
                </span>
                <span>{completedCount}</span>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-ink/10 bg-parchment/88 px-4 backdrop-blur lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center bg-moss text-white lg:hidden">
                <BarChart3 className="h-4 w-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">智能数据分析 Agent</div>
                <div className="truncate text-xs text-ink/45">FastAPI SSE / LangGraph</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-right text-xs text-ink/55 sm:block">
                <span className="block font-semibold text-ink/75">{auth.user.display_name}</span>
                <span>{auth.user.role}</span>
              </span>
              <button
                type="button"
                onClick={logout}
                disabled={isStreaming}
                className="px-2 py-1 text-xs text-ink/55 transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
              >
                退出
              </button>
              <button type="button" onClick={() => setIsSessionsOpen(true)} className="px-2 py-1 text-xs text-ink/55 hover:text-ink">历史</button>
              <button
                type="button"
                onClick={() => setIsAuditOpen(true)}
                disabled={isStreaming}
                className="grid h-9 w-9 place-items-center rounded-full text-ink/55 transition hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
                title="查询审计"
                aria-label="查询审计"
              >
                <ClipboardList className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={clearConversation}
                disabled={messages.length === 0 || isStreaming}
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-full text-ink/55 transition hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-35",
                )}
                title="清空"
                aria-label="清空"
              >
                <Eraser className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {messages.length === 0 ? (
              <EmptyState examples={examples} onUseExample={(example) => setDraft(example)} />
            ) : (
              <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:px-8">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    onUseSuggestion={startQuery}
                    accessToken={auth.accessToken}
                    onFeedbackSaved={(score) => setMessages((current) => current.map((item) => item.id === message.id ? { ...item, feedbackScore: score } : item))}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-ink/10 bg-[#efe6d8]/45 px-4 py-2 text-center text-xs text-ink/45">
            <span className="inline-flex items-center gap-2">
              <Leaf className="h-3.5 w-3.5 text-moss" aria-hidden="true" />
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
          />
        </main>
      </div>
      {isAuditOpen && <AuditPanel accessToken={auth.accessToken} isAdmin={auth.user.role === "admin"} onClose={() => setIsAuditOpen(false)} />}
      {isSessionsOpen && <SessionPanel accessToken={auth.accessToken} onClose={() => setIsSessionsOpen(false)} onSelect={restoreSession} />}
    </div>
  );
}
