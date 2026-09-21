/**
 * SSE 事件到消息状态的纯函数归约
 * 把一条助手消息在收到某个 AgentEvent 后应变成的样子表达为纯函数，便于单元测试
 */
import type { AgentEvent, ChatMessage, StepState } from "../types/agent";
import { summarizeResult } from "./format";

export function upsertStep(steps: StepState[] = [], event: Extract<AgentEvent, { type: "progress" }>) {
  const next = steps.filter((item) => item.step !== event.step);
  next.push({
    step: event.step,
    status: event.status,
    updatedAt: Date.now(),
  });
  return next;
}

/** 事件应用于助手消息；未识别事件按错误终态处理，与后端事件契约保持一致 */
export function applyAgentEventToMessage(
  message: ChatMessage,
  event: AgentEvent,
): ChatMessage {
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
}
