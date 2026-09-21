/**
 * 工作区侧边栏
 * 品牌区、工作区切换、新建入口、会话/项目列表和底部状态区
 */
import {
  Activity,
  BarChart3,
  ChartNoAxesCombined,
  FilePlus2,
  MessagesSquare,
  MessageSquarePlus,
  Pencil,
  Server,
  Trash2,
} from "lucide-react";
import { ConversationList } from "./ConversationList";
import { API_BASE_URL } from "../lib/workspaceStorage";
import { cn } from "../lib/format";
import type { ChatConversation } from "../types/agent";
import type { DataAnalysisProject } from "../types/analysis";
import type { WorkspaceMode } from "../lib/workspaceStorage";

interface WorkspaceSidebarProps {
  workspaceMode: WorkspaceMode;
  isStreaming: boolean;
  conversations: ChatConversation[];
  activeSessionId: string;
  loadingSessionId: string | null;
  analysisProjects: DataAnalysisProject[];
  activeAnalysisId: string;
  completedCount: number;
  onSwitchMode: (mode: WorkspaceMode) => void;
  onStartNew: () => void;
  onSelectConversation: (sessionId: string) => void;
  onRenameConversation: (sessionId: string, title: string) => void;
  onDeleteConversation: (sessionId: string) => void;
  onSelectAnalysis: (projectId: string) => void;
  onRenameAnalysis: (project: DataAnalysisProject) => void;
  onDeleteAnalysis: (projectId: string) => void;
}

export function WorkspaceSidebar(props: WorkspaceSidebarProps) {
  const {
    workspaceMode,
    isStreaming,
    conversations,
    activeSessionId,
    loadingSessionId,
    analysisProjects,
    activeAnalysisId,
    completedCount,
    onSwitchMode,
    onStartNew,
    onSelectConversation,
    onRenameConversation,
    onDeleteConversation,
    onSelectAnalysis,
    onRenameAnalysis,
    onDeleteAnalysis,
  } = props;

  const sortedConversations = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt);
  const sortedProjects = [...analysisProjects].sort((left, right) => right.updatedAt - left.updatedAt);

  return (
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
              onClick={() => onSwitchMode(mode)}
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
          onClick={onStartNew}
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
                activeId={activeSessionId}
                loadingId={loadingSessionId}
                variant="dark"
                onSelect={onSelectConversation}
                onRename={onRenameConversation}
                onDelete={onDeleteConversation}
              />
            ) : sortedProjects.length > 0 ? (
              <div className="space-y-1">
                {sortedProjects.map((project) => (
                  <AnalysisListItem
                    key={project.id}
                    project={project}
                    active={project.id === activeAnalysisId}
                    onSelect={onSelectAnalysis}
                    onRename={onRenameAnalysis}
                    onDelete={onDeleteAnalysis}
                  />
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
  );
}

function AnalysisListItem({
  project,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  project: DataAnalysisProject;
  active: boolean;
  onSelect: (projectId: string) => void;
  onRename: (project: DataAnalysisProject) => void;
  onDelete: (projectId: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition",
        active
          ? "bg-white/10 text-white"
          : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
      )}
    >
      <ChartNoAxesCombined className="h-4 w-4 shrink-0" aria-hidden="true" />
      <button type="button" onClick={() => onSelect(project.id)} className="min-w-0 flex-1 truncate text-left">{project.title}</button>
      {project.status === "running" && <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />}
      <button type="button" onClick={() => onRename(project)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-55 hover:bg-white/10 hover:opacity-100" aria-label="重命名分析项目"><Pencil className="h-3 w-3" /></button>
      <button type="button" onClick={() => onDelete(project.id)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md opacity-55 hover:bg-rose-500/20 hover:text-rose-300 hover:opacity-100" aria-label="删除分析项目"><Trash2 className="h-3 w-3" /></button>
    </div>
  );
}
