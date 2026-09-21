/**
 * 前端应用主组件
 * 只负责组装各工作区 Hook 与布局组件；状态逻辑在 hooks/，纯函数在 lib/
 */
import { ChartNoAxesCombined } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnalysisWorkspace } from "./components/AnalysisWorkspace";
import { AskWorkspace } from "./components/AskWorkspace";
import { AuditPanel } from "./components/AuditPanel";
import { LoginPanel } from "./components/LoginPanel";
import { MobileSessionsDrawer } from "./components/MobileSessionsDrawer";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar";
import { useAgentStream } from "./hooks/useAgentStream";
import { useAnalysisProjects } from "./hooks/useAnalysisProjects";
import { useAuth } from "./hooks/useAuth";
import { useConversations } from "./hooks/useConversations";
import {
  FLOW_VISIBILITY_STORAGE_KEY,
  examples,
  loadFlowVisibility,
  loadWorkspaceMode,
  type StoredAuth,
  type WorkspaceMode,
} from "./lib/workspaceStorage";

export default function App() {
  const [draft, setDraft] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState(loadWorkspaceMode);
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isSessionsOpen, setIsSessionsOpen] = useState(false);
  const [showFlow, setShowFlow] = useState(loadFlowVisibility);
  const [composerNotice, setComposerNotice] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((message: string) => setComposerNotice(message), []);

  // 登录过期时中断进行中的流式请求；abortRef 由流式 Hook 就绪后回填
  const abortRef = useRef<() => void>(() => {});
  const onAuthExpired = useCallback(() => abortRef.current(), []);
  const { auth, loginNotice, setLoginNotice, handleLoggedIn, logout } = useAuth(onAuthExpired);

  const {
    conversations, conversationsRef, sessionId, activeConversation, messages,
    loadingSessionId, patchConversation, setMessages, startNewConversation,
    selectConversation, renameConversation, removeConversation,
  } = useConversations({ auth, notify });

  const { isStreaming, startQuery, stopQuery, abortActive } = useAgentStream({
    auth,
    sessionId,
    draft,
    setDraft,
    conversationsRef,
    patchConversation,
    setMessages,
    notify,
  });
  // 登录过期/删除活动会话时的中断动作：停止流并清空输入
  abortRef.current = () => {
    abortActive();
    setDraft("");
  };

  const {
    analysisProjects, activeAnalysisId, activeAnalysisProject, setActiveAnalysisId,
    startNewAnalysis, updateAnalysisProject, renameAnalysisProject, removeAnalysisProject,
  } = useAnalysisProjects({ auth, notify, workspaceMode, setWorkspaceMode });

  const activeAnalysis = activeAnalysisProject;

  // 本地持久化流程可见性开关
  useEffect(() => {
    window.localStorage.setItem(FLOW_VISIBILITY_STORAGE_KEY, String(showFlow));
  }, [showFlow]);

  // 通知文案自动消失
  useEffect(() => {
    if (!composerNotice) return;
    const timer = window.setTimeout(() => setComposerNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [composerNotice]);

  const completedCount = useMemo(
    () => messages.filter((message) => message.role === "assistant" && message.status === "done").length,
    [messages],
  );

  const startNewConversationWithUi = useCallback(() => {
    abortActive();
    setDraft("");
    startNewConversation();
    setIsAuditOpen(false);
    setIsSessionsOpen(false);
    setComposerNotice("新问数已创建，可以开始提问");
    setFocusSignal((value) => value + 1);
  }, [abortActive, startNewConversation]);

  const startNewAnalysisWithUi = useCallback(() => {
    startNewAnalysis();
    setIsSessionsOpen(false);
  }, [startNewAnalysis]);

  const handleLoggedInWithUi = useCallback((nextAuth: StoredAuth) => {
    handleLoggedIn(nextAuth);
    setDraft("");
  }, [handleLoggedIn]);

  const logoutWithUi = useCallback(() => {
    if (isStreaming) return;
    logout();
    setDraft("");
  }, [isStreaming, logout]);

  const switchWorkspaceMode = useCallback((mode: WorkspaceMode) => {
    if (isStreaming || mode === workspaceMode) return;
    setWorkspaceMode(mode);
    setIsAuditOpen(false);
    setIsSessionsOpen(false);
  }, [isStreaming, workspaceMode]);

  const selectConversationWithUi = useCallback((nextSessionId: string) => {
    if (!auth) return;
    if (nextSessionId === sessionId) {
      setIsSessionsOpen(false);
      return;
    }
    abortActive();
    setDraft("");
    setFocusSignal((value) => value + 1);
    setIsSessionsOpen(false);
    selectConversation(nextSessionId);
  }, [auth, abortActive, selectConversation, sessionId]);

  const removeConversationWithUi = useCallback((targetSessionId: string) => {
    void removeConversation(targetSessionId);
  }, [removeConversation]);

  const headerTitle = workspaceMode === "ask"
    ? activeConversation?.title ?? "问数工作台"
    : activeAnalysis?.title ?? "数据分析工作台";

  if (!auth) {
    return <LoginPanel onLoggedIn={handleLoggedInWithUi} notice={loginNotice} />;
  }

  return (
    <div className="h-dvh overflow-hidden bg-parchment text-ink">
      <div className="pointer-events-none fixed inset-0 grain" />

      <div className="relative grid h-full min-h-0 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
        <WorkspaceSidebar
          workspaceMode={workspaceMode}
          isStreaming={isStreaming}
          conversations={conversations}
          activeSessionId={sessionId}
          loadingSessionId={loadingSessionId}
          analysisProjects={analysisProjects}
          activeAnalysisId={activeAnalysisId}
          completedCount={completedCount}
          onSwitchMode={switchWorkspaceMode}
          onStartNew={workspaceMode === "ask" ? startNewConversationWithUi : startNewAnalysisWithUi}
          onSelectConversation={selectConversationWithUi}
          onRenameConversation={renameConversation}
          onDeleteConversation={removeConversationWithUi}
          onSelectAnalysis={setActiveAnalysisId}
          onRenameAnalysis={renameAnalysisProject}
          onDeleteAnalysis={removeAnalysisProject}
        />

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <WorkspaceHeader
            workspaceMode={workspaceMode}
            isStreaming={isStreaming}
            title={headerTitle}
            user={auth.user}
            onSwitchMode={() => switchWorkspaceMode(workspaceMode === "ask" ? "analysis" : "ask")}
            onLogout={logoutWithUi}
            onOpenSessions={() => setIsSessionsOpen(true)}
            onOpenAudit={() => setIsAuditOpen(true)}
            onStartNew={workspaceMode === "ask" ? startNewConversationWithUi : startNewAnalysisWithUi}
          />

          {workspaceMode === "ask" ? (
            <AskWorkspace
              scrollRef={scrollRef}
              messages={messages}
              isStreaming={isStreaming}
              draft={draft}
              canSubmit={draft.trim().length > 0 && !isStreaming}
              showFlow={showFlow}
              notice={composerNotice}
              focusSignal={focusSignal}
              accessToken={auth.accessToken}
              onUseExample={(example) => setDraft(example)}
              onSubmit={() => void startQuery()}
              onStop={stopQuery}
              onChange={setDraft}
              onToggleFlow={() => setShowFlow((value) => !value)}
              onRetrySuggestion={(query) => void startQuery(query)}
              onFeedbackSaved={(messageId, score) => setMessages(sessionId, (current) => current.map((item) => item.id === messageId ? { ...item, feedbackScore: score } : item))}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {activeAnalysis ? (
                <AnalysisWorkspace
                  key={activeAnalysis.id}
                  project={activeAnalysis}
                  accessToken={auth.accessToken}
                  onChange={updateAnalysisProject}
                />
              ) : (
                <div className="flex min-h-full items-center justify-center p-6 text-center">
                  <div><ChartNoAxesCombined className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-3 text-sm text-slate-500">新建一个分析项目开始工作</p><button type="button" onClick={startNewAnalysisWithUi} className="mt-4 rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white">新建分析项目</button></div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {workspaceMode === "ask" && isAuditOpen && (
        <AuditPanel accessToken={auth.accessToken} isAdmin={auth.user.role === "admin"} onClose={() => setIsAuditOpen(false)} />
      )}

      <MobileSessionsDrawer
        open={isSessionsOpen}
        workspaceMode={workspaceMode}
        conversations={conversations}
        activeSessionId={sessionId}
        loadingSessionId={loadingSessionId}
        analysisProjects={analysisProjects}
        activeAnalysisId={activeAnalysisId}
        onClose={() => setIsSessionsOpen(false)}
        onStartNew={workspaceMode === "ask" ? startNewConversationWithUi : startNewAnalysisWithUi}
        onSelectConversation={selectConversationWithUi}
        onRenameConversation={renameConversation}
        onDeleteConversation={removeConversationWithUi}
        onSelectAnalysis={(projectId) => { setActiveAnalysisId(projectId); setIsSessionsOpen(false); }}
        onRenameAnalysis={renameAnalysisProject}
        onDeleteAnalysis={removeAnalysisProject}
      />
    </div>
  );
}
