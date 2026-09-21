/**
 * 工作区顶栏
 * 标题、移动端工作区切换、用户信息、退出与快捷操作
 */
import {
  BarChart3,
  ChartNoAxesCombined,
  ClipboardList,
  FilePlus2,
  MessagesSquare,
  MessageSquarePlus,
} from "lucide-react";
import { cn } from "../lib/format";
import type { CurrentUser } from "../types/agent";
import type { WorkspaceMode } from "../lib/workspaceStorage";

interface WorkspaceHeaderProps {
  workspaceMode: WorkspaceMode;
  isStreaming: boolean;
  title: string;
  user: CurrentUser;
  onSwitchMode: () => void;
  onLogout: () => void;
  onOpenSessions: () => void;
  onOpenAudit: () => void;
  onStartNew: () => void;
}

export function WorkspaceHeader(props: WorkspaceHeaderProps) {
  const {
    workspaceMode,
    isStreaming,
    title,
    user,
    onSwitchMode,
    onLogout,
    onOpenSessions,
    onOpenAudit,
    onStartNew,
  } = props;

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur-xl lg:px-7">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-moss to-brass text-white lg:hidden">
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{title}</div>
          <div className="truncate text-xs text-slate-500">
            {workspaceMode === "ask" ? "快速问数 · 实时回答" : "制定计划 · 审核步骤 · 生成洞察"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSwitchMode}
          disabled={isStreaming}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-50 px-2.5 text-xs font-semibold text-moss transition hover:bg-blue-100 disabled:opacity-40 lg:hidden"
          aria-label={workspaceMode === "ask" ? "切换到数据分析" : "切换到问数"}
        >
          {workspaceMode === "ask" ? <ChartNoAxesCombined className="h-3.5 w-3.5" /> : <MessagesSquare className="h-3.5 w-3.5" />}
          {workspaceMode === "ask" ? "数据分析" : "问数"}
        </button>
        <span className="hidden text-right text-xs text-slate-500 sm:block">
          <span className="block font-semibold text-slate-700">{user.display_name}</span>
          <span>{user.role}</span>
        </span>
        <button
          type="button"
          onClick={onLogout}
          disabled={isStreaming}
          className="px-2 py-1 text-xs text-slate-500 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
        >
          退出
        </button>
        <button
          type="button"
          onClick={onOpenSessions}
          className="px-2 py-1 text-xs text-slate-500 hover:text-slate-900 lg:hidden"
        >
          {workspaceMode === "ask" ? "会话" : "项目"}
        </button>
        {workspaceMode === "ask" && <button
          type="button"
          onClick={onOpenAudit}
          disabled={isStreaming}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
          title="查询审计"
          aria-label="查询审计"
        >
          <ClipboardList className="h-4 w-4" aria-hidden="true" />
        </button>}
        <button
          type="button"
          onClick={onStartNew}
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
  );
}
