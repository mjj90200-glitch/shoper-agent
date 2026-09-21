/**
 * 移动端会话/项目抽屉
 * 小屏下从右侧滑出的列表容器，复用会话列表与分析项目列表
 */
import {
  ChartNoAxesCombined,
  FilePlus2,
  MessageSquarePlus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { ConversationList } from "./ConversationList";
import { cn } from "../lib/format";
import type { ChatConversation } from "../types/agent";
import type { DataAnalysisProject } from "../types/analysis";
import type { WorkspaceMode } from "../lib/workspaceStorage";

interface MobileSessionsDrawerProps {
  open: boolean;
  workspaceMode: WorkspaceMode;
  conversations: ChatConversation[];
  activeSessionId: string;
  loadingSessionId: string | null;
  analysisProjects: DataAnalysisProject[];
  activeAnalysisId: string;
  onClose: () => void;
  onStartNew: () => void;
  onSelectConversation: (sessionId: string) => void;
  onRenameConversation: (sessionId: string, title: string) => void;
  onDeleteConversation: (sessionId: string) => void;
  onSelectAnalysis: (projectId: string) => void;
  onRenameAnalysis: (project: DataAnalysisProject) => void;
  onDeleteAnalysis: (projectId: string) => void;
}

export function MobileSessionsDrawer(props: MobileSessionsDrawerProps) {
  const {
    open,
    workspaceMode,
    conversations,
    activeSessionId,
    loadingSessionId,
    analysisProjects,
    activeAnalysisId,
    onClose,
    onStartNew,
    onSelectConversation,
    onRenameConversation,
    onDeleteConversation,
    onSelectAnalysis,
    onRenameAnalysis,
    onDeleteAnalysis,
  } = props;

  if (!open) return null;
  const sortedConversations = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt);
  const sortedProjects = [...analysisProjects].sort((left, right) => right.updatedAt - left.updatedAt);

  return (
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
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800"
            aria-label="关闭会话列表"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>
        <button
          type="button"
          onClick={onStartNew}
          className="mb-4 flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-moss text-sm font-semibold text-white shadow-lg shadow-moss/15"
        >
          {workspaceMode === "ask" ? <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
          {workspaceMode === "ask" ? "新问数" : "新建分析"}
        </button>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {workspaceMode === "ask" ? <ConversationList
            conversations={sortedConversations}
            activeId={activeSessionId}
            loadingId={loadingSessionId}
            onSelect={onSelectConversation}
            onRename={onRenameConversation}
            onDelete={onDeleteConversation}
          /> : sortedProjects.length > 0 ? (
            <div className="space-y-1">
              {sortedProjects.map((project) => (
                <div key={project.id} className={cn("flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm", project.id === activeAnalysisId ? "bg-blue-50 text-moss" : "text-slate-600 hover:bg-slate-50")}>
                  <ChartNoAxesCombined className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <button type="button" onClick={() => onSelectAnalysis(project.id)} className="min-w-0 flex-1 truncate text-left">{project.title}</button>
                  <button type="button" onClick={() => onRenameAnalysis(project)} aria-label="重命名分析项目"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => onDeleteAnalysis(project.id)} className="text-rose-500" aria-label="删除分析项目"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          ) : <div className="py-8 text-center text-sm text-slate-400">暂无分析项目</div>}
        </div>
      </section>
    </div>
  );
}
