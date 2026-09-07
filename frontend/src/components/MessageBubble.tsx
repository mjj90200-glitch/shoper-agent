/**
 * 聊天消息气泡组件
 * 组合展示用户问题、智能体回复、执行流程和结果表格
 */
import { Bot, Copy, UserRound } from "lucide-react";
import { ResultTable } from "./ResultTable";
import { ResultInsight } from "./ResultInsight";
import { CompactStepStatus, StepRail } from "./StepRail";
import { FeedbackControls } from "./FeedbackControls";
import { cn, formatTime, toClipboardText } from "../lib/format";
import type { ChatMessage } from "../types/agent";

type MessageBubbleProps = {
  message: ChatMessage;
  onUseSuggestion?: (query: string) => void;
  accessToken?: string;
  onFeedbackSaved?: (score: "up" | "down") => void;
  showFlow?: boolean;
};

export function MessageBubble({ message, onUseSuggestion, accessToken, onFeedbackSaved, showFlow = true }: MessageBubbleProps) {
  const isUser = message.role === "user";

  const copy = async () => {
    const text = message.result ? toClipboardText(message.result) : message.content;
    await navigator.clipboard.writeText(text);
  };

  return (
    <article className={cn("group flex gap-3.5", isUser && "justify-end")}>
      {!isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-moss to-brass text-white shadow-md shadow-moss/15">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
      )}

      <div className={cn("max-w-[980px] flex-1", isUser && "flex max-w-[760px] justify-end")}>
        <div
          className={cn(
            "relative px-5 py-4",
            isUser
              ? "rounded-2xl rounded-tr-md bg-moss text-white shadow-md shadow-moss/10"
              : "rounded-2xl border border-slate-200/80 bg-white/85 text-ink shadow-[0_8px_30px_rgba(15,23,42,0.055)] backdrop-blur",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
            {!isUser && message.status !== "streaming" && (
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 opacity-0 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 focus:ring-2 focus:ring-moss/30 group-hover:opacity-100"
                title="复制"
                aria-label="复制"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {message.error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-tomato">
              {message.error}
            </div>
          )}

          {!isUser && !message.category && (showFlow ? <StepRail steps={message.steps} /> : <CompactStepStatus steps={message.steps} />)}
          {!isUser &&
            message.resolvedQuery &&
            message.originalQuery !== message.resolvedQuery && (
              <div className="mt-3 rounded-r-xl border-l-2 border-moss/60 bg-blue-50 px-3 py-2 text-sm leading-6 text-slate-700">
                已结合上下文理解为：{message.resolvedQuery}
              </div>
            )}
          {!isUser && message.sql && (
            <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-slate-600">执行 SQL</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-slate-700">
                {message.sql}
              </pre>
            </details>
          )}
          {!isUser && message.analysis && message.result !== undefined && <ResultInsight analysis={message.analysis} data={message.result} />}
          {!isUser && message.result !== undefined && <ResultTable data={message.result} />}

          {!isUser && message.status === "done" && message.auditId && accessToken && (
            <FeedbackControls
              auditId={message.auditId}
              accessToken={accessToken}
              initialScore={message.feedbackScore}
              onSaved={(score) => onFeedbackSaved?.(score)}
            />
          )}

          {!isUser && message.suggestedQueries && message.suggestedQueries.length > 0 && (
            <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-moss">
                你可以这样问
              </div>
              <div className="flex flex-wrap gap-2">
                {message.suggestedQueries.map((query) => (
                  <button
                    key={query}
                    type="button"
                    onClick={() => onUseSuggestion?.(query)}
                    className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-moss hover:text-moss"
                  >
                    {query}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div
            className={cn(
              "mt-3 text-xs",
              isUser ? "text-white/60" : "text-slate-400",
            )}
          >
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>

      {isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-600">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
    </article>
  );
}
