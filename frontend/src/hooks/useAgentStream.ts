/**
 * 问数流式请求 Hook
 * 管理 SSE 流的生命周期：发起、事件归约到消息、停止、结束后同步会话标题
 */
import { useCallback, useState } from "react";

import { streamQuery } from "../lib/agentApi";
import { applyAgentEventToMessage } from "../lib/agentEvents";
import { renameSession } from "../lib/sessionApi";
import {
  deriveConversationTitle,
  makeId,
  type StoredAuth,
} from "../lib/workspaceStorage";
import type { AgentEvent, ChatConversation, ChatMessage } from "../types/agent";

type Notify = (message: string) => void;

export function useAgentStream(options: {
  auth: StoredAuth | null;
  sessionId: string;
  draft: string;
  setDraft: (value: string) => void;
  conversationsRef: React.RefObject<ChatConversation[]>;
  patchConversation: (sessionId: string, patch: (conversation: ChatConversation) => ChatConversation) => void;
  setMessages: (sessionId: string, updater: (current: ChatMessage[]) => ChatMessage[]) => void;
  notify: Notify;
}) {
  const { auth, sessionId, draft, setDraft, conversationsRef, patchConversation, setMessages, notify } = options;
  const [activeController, setActiveController] = useState<AbortController | null>(null);
  const isStreaming = Boolean(activeController);

  const startQuery = useCallback(async (rawQuery = draft) => {
    const query = rawQuery.trim();
    if (!query || activeController || !auth) return;

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
    patchConversation(sessionId, (conversation) => (
      !conversation.customTitle && conversation.messages.length === 0
        ? { ...conversation, title: deriveConversationTitle(query), updatedAt: Date.now() }
        : conversation
    ));
    setMessages(sessionId, (current) => [...current, userMessage, assistantMessage]);

    const onEvent = (event: AgentEvent) => {
      setMessages(sessionId, (current) =>
        current.map((message) => (
          message.id === assistantId ? applyAgentEventToMessage(message, event) : message
        )),
      );
    };

    try {
      await streamQuery(query, {
        sessionId,
        accessToken: auth.accessToken,
        signal: controller.signal,
        onEvent,
      });
      setMessages(sessionId, (current) =>
        current.map((message) =>
          message.id === assistantId && message.status === "streaming"
            ? { ...message, status: "done", content: "流程已结束，后端未返回查询结果。" }
            : message,
        ),
      );
      patchConversation(sessionId, (conversation) => ({ ...conversation, remote: true }));
      const savedConversation = conversationsRef.current?.find(
        (conversation) => conversation.sessionId === sessionId,
      );
      if (savedConversation?.customTitle) {
        void renameSession(sessionId, savedConversation.title, auth.accessToken).catch(() => {
          notify("会话名称已保存在本机，服务端同步将在下次重试");
        });
      }
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === "AbortError";
      setMessages(sessionId, (current) =>
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
  }, [activeController, auth, conversationsRef, draft, notify, patchConversation, sessionId, setDraft, setMessages]);

  const stopQuery = useCallback(() => {
    activeController?.abort();
  }, [activeController]);

  const abortActive = useCallback(() => {
    setActiveController((current) => {
      current?.abort();
      return null;
    });
  }, []);

  return { isStreaming, activeController, startQuery, stopQuery, abortActive };
}
