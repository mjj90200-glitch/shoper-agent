import { Check, LoaderCircle, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/format";
import type { ChatConversation } from "../types/agent";

function formatUpdatedAt(timestamp: number) {
  const value = new Date(timestamp);
  const today = new Date();
  const isToday = value.toDateString() === today.toDateString();

  return isToday
    ? value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
    : value.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

type ConversationListProps = {
  conversations: ChatConversation[];
  activeId: string;
  loadingId?: string | null;
  variant?: "light" | "dark";
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => Promise<void> | void;
};

export function ConversationList({
  conversations,
  activeId,
  loadingId,
  variant = "light",
  onSelect,
  onRename,
  onDelete,
}: ConversationListProps) {
  const isDark = variant === "dark";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  const beginRename = (conversation: ChatConversation) => {
    setConfirmingDeleteId(null);
    setEditingId(conversation.sessionId);
    setEditingTitle(conversation.title);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const saveRename = () => {
    if (!editingId) return;
    const title = editingTitle.trim();
    if (title) onRename(editingId, title);
    cancelRename();
  };

  return (
    <div className="space-y-1" aria-label="会话列表">
      {conversations.map((conversation) => {
        const isActive = conversation.sessionId === activeId;
        const isEditing = conversation.sessionId === editingId;
        const isConfirmingDelete = conversation.sessionId === confirmingDeleteId;

        return (
          <div
            key={conversation.sessionId}
            className={cn(
              "group relative border transition",
              isDark
                ? isActive
                  ? "rounded-xl border-white/10 bg-white/10 shadow-line"
                  : "rounded-xl border-transparent hover:bg-white/[0.06]"
                : isActive
                  ? "rounded-xl border-moss/20 bg-blue-50 shadow-line"
                  : "rounded-xl border-transparent hover:border-slate-200 hover:bg-white/70",
            )}
          >
            {isConfirmingDelete ? (
              <div className="flex min-h-14 items-center gap-2 px-3 py-2">
                <span className={cn("min-w-0 flex-1 text-xs leading-4", isDark ? "text-slate-300" : "text-ink/65")}>
                  删除“<span className={cn("font-semibold", isDark ? "text-white" : "text-ink")}>{conversation.title}</span>”？
                </span>
                <button
                  type="button"
                  disabled={deletingId === conversation.sessionId}
                  onClick={() => setConfirmingDeleteId(null)}
                  className={cn("shrink-0 rounded-lg px-2 py-1.5 text-xs disabled:opacity-40", isDark ? "text-slate-400 hover:bg-white/10 hover:text-white" : "text-ink/50 hover:bg-ink/5 hover:text-ink")}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={deletingId === conversation.sessionId}
                  onClick={() => {
                    setDeletingId(conversation.sessionId);
                    void Promise.resolve(onDelete(conversation.sessionId)).finally(() => {
                      setDeletingId(null);
                      setConfirmingDeleteId(null);
                    });
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-tomato px-2 py-1.5 text-xs font-semibold text-white hover:bg-tomato/85 disabled:opacity-55"
                >
                  {deletingId === conversation.sessionId && (
                    <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden="true" />
                  )}
                  删除
                </button>
              </div>
            ) : isEditing ? (
              <div className="flex h-14 items-center gap-1.5 px-2">
                <input
                  ref={inputRef}
                  value={editingTitle}
                  maxLength={80}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveRename();
                    if (event.key === "Escape") cancelRename();
                  }}
                  className={cn("min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-sm outline-none", isDark ? "border-white/15 bg-white/10 text-white focus:border-moss" : "border-moss/35 bg-white focus:border-moss")}
                  aria-label="会话名称"
                />
                <button
                  type="button"
                  onClick={saveRename}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-moss hover:bg-moss/10"
                  aria-label="保存名称"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={cancelRename}
                  className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", isDark ? "text-slate-400 hover:bg-white/10 hover:text-white" : "text-ink/45 hover:bg-ink/5 hover:text-ink")}
                  aria-label="取消编辑"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onSelect(conversation.sessionId)}
                  className="flex h-14 w-full items-center gap-2.5 px-3 pr-[5.25rem] text-left"
                  aria-current={isActive ? "page" : undefined}
                >
                  <span
                    className={cn(
                      "grid h-7 w-7 shrink-0 place-items-center",
                      "rounded-lg",
                      isActive
                        ? "bg-moss text-white"
                        : isDark
                          ? "bg-white/5 text-slate-500"
                          : "bg-slate-100 text-slate-500",
                    )}
                  >
                    {loadingId === conversation.sessionId ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm font-medium", isDark ? "text-slate-200" : "text-ink/80")}>
                      {conversation.title}
                    </span>
                    <span className={cn("mt-0.5 block text-[11px]", isDark ? "text-slate-500" : "text-ink/38")}>
                      {conversation.messages.length > 0
                        ? `${Math.ceil(conversation.messages.length / 2)} 轮 · ${formatUpdatedAt(conversation.updatedAt)}`
                        : conversation.remote
                          ? `历史会话 · ${formatUpdatedAt(conversation.updatedAt)}`
                          : `空白会话 · ${formatUpdatedAt(conversation.updatedAt)}`}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => beginRename(conversation)}
                  className={cn(
                    "absolute right-10 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg transition",
                    isDark ? "text-slate-500 hover:bg-white/10 hover:text-white" : "text-ink/35 hover:bg-ink/5 hover:text-ink",
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                  )}
                  aria-label={`重命名${conversation.title}`}
                  title="重命名"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(null);
                    setConfirmingDeleteId(conversation.sessionId);
                  }}
                  className={cn(
                    "absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg transition hover:bg-tomato/10 hover:text-tomato",
                    isDark ? "text-slate-500" : "text-ink/35",
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                  )}
                  aria-label={`删除${conversation.title}`}
                  title="删除会话"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
