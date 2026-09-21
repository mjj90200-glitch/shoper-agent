/**
 * 问数会话 Hook
 * 管理会话列表、活动会话选择、本地持久化、服务端历史合并与会话增删改
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIVE_CONVERSATION_STORAGE_KEY,
  CONVERSATIONS_STORAGE_KEY,
  LEGACY_CONVERSATION_STORAGE_KEY,
  createConversation,
  loadConversationWorkspace,
  recordsToMessages,
} from "../lib/workspaceStorage";
import { deleteSession, fetchSession, fetchSessions, renameSession } from "../lib/sessionApi";
import type { ChatConversation, ChatMessage } from "../types/agent";

type Notify = (message: string) => void;

export function useConversations(options: {
  auth: { accessToken: string } | null;
  notify: Notify;
  /** 会话从服务端删除成功后、本地列表移除前触发（用于中断进行中的流） */
  onBeforeRemove?: (targetSessionId: string) => void;
}) {
  const { auth, notify, onBeforeRemove } = options;
  const [initialWorkspace] = useState(loadConversationWorkspace);
  const [conversations, setConversations] = useState<ChatConversation[]>(
    initialWorkspace.conversations,
  );
  const [sessionId, setSessionId] = useState(initialWorkspace.activeSessionId);
  const [loadingSessionId, setLoadingSessionId] = useState<string | null>(null);
  const conversationsRef = useRef(conversations);

  const activeConversation = conversations.find((item) => item.sessionId === sessionId)
    ?? conversations[0];
  const messages = activeConversation?.messages ?? [];

  const patchConversation = useCallback(
    (targetSessionId: string, patch: (conversation: ChatConversation) => ChatConversation) => {
      setConversations((current) => current.map((conversation) => (
        conversation.sessionId === targetSessionId ? patch(conversation) : conversation
      )));
    },
    [],
  );

  const setMessages = useCallback(
    (targetSessionId: string, updater: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) => {
      setConversations((current) => current.map((conversation) => {
        if (conversation.sessionId !== targetSessionId) return conversation;
        const nextMessages = typeof updater === "function"
          ? updater(conversation.messages)
          : updater;
        return { ...conversation, messages: nextMessages, updatedAt: Date.now() };
      }));
    },
    [],
  );

  // 本地持久化 + 活动会话 ID
  useEffect(() => {
    conversationsRef.current = conversations;
    try {
      window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(conversations));
      window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, sessionId);
      window.localStorage.removeItem(LEGACY_CONVERSATION_STORAGE_KEY);
    } catch {
      notify("本地会话空间已满，新内容暂时无法持久保存");
    }
  }, [conversations, sessionId, notify]);

  // 活动会话被删除后回退到最近更新的会话
  useEffect(() => {
    if (conversations.length === 0 || conversations.some((item) => item.sessionId === sessionId)) {
      return;
    }
    const newest = [...conversations].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    setSessionId(newest.sessionId);
  }, [conversations, sessionId]);

  // 登录后合并服务端会话列表（本地记录优先保留未同步内容）
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

  const startNewConversation = useCallback(() => {
    const nextConversation = createConversation();
    setConversations((current) => [nextConversation, ...current]);
    setSessionId(nextConversation.sessionId);
    return nextConversation.sessionId;
  }, []);

  const renameConversation = useCallback((targetSessionId: string, title: string) => {
    const selected = conversationsRef.current.find(
      (conversation) => conversation.sessionId === targetSessionId,
    );
    patchConversation(targetSessionId, (conversation) => ({
      ...conversation,
      title,
      customTitle: true,
      updatedAt: Date.now(),
    }));

    if (selected?.remote && auth) {
      void renameSession(targetSessionId, title, auth.accessToken)
        .catch(() => notify("会话名称已保存在本机，服务端同步将在下次重试"));
    }
  }, [auth, notify, patchConversation]);

  const removeConversation = useCallback(async (targetSessionId: string) => {
    const selected = conversationsRef.current.find(
      (conversation) => conversation.sessionId === targetSessionId,
    );
    if (!selected) return;

    if (selected.remote && auth) {
      try {
        await deleteSession(targetSessionId, auth.accessToken);
      } catch {
        notify("删除失败，会话内容仍然保留");
        return;
      }
    }

    onBeforeRemove?.(targetSessionId);
    setLoadingSessionId((current) => current === targetSessionId ? null : current);
    setConversations((current) => {
      const remaining = current.filter(
        (conversation) => conversation.sessionId !== targetSessionId,
      );
      return remaining.length > 0 ? remaining : [createConversation()];
    });
    notify("会话已删除");
  }, [auth, notify, onBeforeRemove]);

  const selectConversation = useCallback((nextSessionId: string) => {
    if (nextSessionId === sessionId) return;
    setSessionId(nextSessionId);

    const selected = conversations.find((item) => item.sessionId === nextSessionId);
    if (!selected || selected.messages.length > 0 || !selected.remote || !auth) return;

    setLoadingSessionId(nextSessionId);
    void fetchSession(nextSessionId, auth.accessToken)
      .then((records) => {
        patchConversation(nextSessionId, (conversation) => ({
          ...conversation,
          messages: recordsToMessages(records),
        }));
      })
      .catch(() => notify("暂时无法加载这个历史会话"))
      .finally(() => setLoadingSessionId((current) => (
        current === nextSessionId ? null : current
      )));
  }, [auth, conversations, notify, patchConversation, sessionId]);

  return {
    conversations,
    conversationsRef,
    sessionId,
    activeConversation,
    messages,
    loadingSessionId,
    setSessionId,
    patchConversation,
    setMessages,
    startNewConversation,
    selectConversation,
    renameConversation,
    removeConversation,
    setLoadingSessionId,
  };
}
