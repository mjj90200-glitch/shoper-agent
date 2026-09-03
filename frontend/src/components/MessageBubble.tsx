/**
 * 聊天消息气泡组件
 * 组合展示用户问题、智能体回复、执行流程和结果表格
 */
import { Bot, Copy, UserRound } from "lucide-react";
import { ResultTable } from "./ResultTable";
import { ResultInsight } from "./ResultInsight";
import { StepRail } from "./StepRail";
import { FeedbackControls } from "./FeedbackControls";
import { cn, formatTime, toClipboardText } from "../lib/format";
import type { ChatMessage } from "../types/agent";

type MessageBubbleProps = {
  message: ChatMessage;
  onUseSuggestion?: (query: string) => void;
  accessToken?: string;
  onFeedbackSaved?: (score: "up" | "down") => void;
};

export function MessageBubble({ message, onUseSuggestion, accessToken, onFeedbackSaved }: MessageBubbleProps) {
  const isUser = message.role === "user";

  const copy = async () => {
    const text = message.result ? toClipboardText(message.result) : message.content;
    await navigator.clipboard.writeText(text);
  };

  return (
    <article className={cn("group flex gap-3", isUser && "justify-end")}>
      {!isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-parchment">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </div>
      )}

      <div className={cn("max-w-[920px] flex-1", isUser && "flex max-w-[760px] justify-end")}>
        <div
          className={cn(
            "relative border px-5 py-4 shadow-line",
            isUser
              ? "border-ink/80 bg-ink text-parchment"
              : "border-ink/10 bg-[#fffaf1]/78 text-ink backdrop-blur",
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-wrap text-[15px] leading-7">{message.content}</p>
            {!isUser && message.status !== "streaming" && (
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded-full p-1.5 text-ink/45 opacity-0 outline-none transition hover:bg-ink/5 hover:text-ink focus:opacity-100 focus:ring-2 focus:ring-moss/40 group-hover:opacity-100"
                title="复制"
                aria-label="复制"
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {message.error && (
            <div className="mt-3 border border-tomato/30 bg-tomato/10 px-3 py-2 text-sm text-tomato">
              {message.error}
            </div>
          )}

          {!isUser && !message.category && <StepRail steps={message.steps} />}
          {!isUser &&
            message.resolvedQuery &&
            message.originalQuery !== message.resolvedQuery && (
              <div className="mt-3 border-l-2 border-moss/50 bg-moss/5 px-3 py-2 text-sm leading-6 text-ink/70">
                已结合上下文理解为：{message.resolvedQuery}
              </div>
            )}
          {!isUser && message.sql && (
            <details className="mt-3 border border-ink/10 bg-ink/[0.025] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-ink/70">执行 SQL</summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-ink/75">
                {message.sql}
              </pre>
            </details>
          )}
          {!isUser && message.result !== undefined && <ResultTable data={message.result} />}
          {!isUser && message.analysis && <ResultInsight analysis={message.analysis} />}

          {!isUser && message.status === "done" && message.auditId && accessToken && (
            <FeedbackControls
              auditId={message.auditId}
              accessToken={accessToken}
              initialScore={message.feedbackScore}
              onSaved={(score) => onFeedbackSaved?.(score)}
            />
          )}

          {!isUser && message.suggestedQueries && message.suggestedQueries.length > 0 && (
            <section className="mt-4 border border-moss/20 bg-moss/5 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-moss">
                你可以这样问
              </div>
              <div className="flex flex-wrap gap-2">
                {message.suggestedQueries.map((query) => (
                  <button
                    key={query}
                    type="button"
                    onClick={() => onUseSuggestion?.(query)}
                    className="border border-moss/25 bg-white/70 px-3 py-2 text-left text-sm text-ink/80 transition hover:border-moss/55 hover:bg-white"
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
              isUser ? "text-parchment/55" : "text-ink/45",
            )}
          >
            {formatTime(message.createdAt)}
          </div>
        </div>
      </div>

      {isUser && (
        <div className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-moss text-white">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
    </article>
  );
}
