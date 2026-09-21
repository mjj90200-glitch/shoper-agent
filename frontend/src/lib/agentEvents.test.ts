/**
 * SSE 事件归约纯函数测试
 */
import { describe, expect, it } from "vitest";

import { applyAgentEventToMessage, upsertStep } from "./agentEvents";
import type { ChatMessage } from "../types/agent";

function streamingMessage(): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    content: "正在连接问数智能体...",
    createdAt: 1,
    status: "streaming",
    steps: [],
  };
}

describe("upsertStep", () => {
  it("追加新步骤并替换同名的旧状态", () => {
    let steps = upsertStep([], { type: "progress", step: "生成SQL", status: "running" });
    expect(steps).toHaveLength(1);
    steps = upsertStep(steps, { type: "progress", step: "执行SQL", status: "running" });
    expect(steps.map((step) => step.step)).toEqual(["生成SQL", "执行SQL"]);
    steps = upsertStep(steps, { type: "progress", step: "生成SQL", status: "done" });
    expect(steps).toHaveLength(2);
    expect(steps.find((step) => step.step === "生成SQL")?.status).toBe("done");
  });
});

describe("applyAgentEventToMessage", () => {
  it("progress 事件更新步骤并改写运行中文案", () => {
    const next = applyAgentEventToMessage(streamingMessage(), {
      type: "progress",
      step: "执行SQL",
      status: "running",
    });
    expect(next.status).toBe("streaming");
    expect(next.content).toBe("正在执行：执行SQL");
    expect(next.steps).toHaveLength(1);
  });

  it("result 事件收敛为 done 并携带结果", () => {
    const next = applyAgentEventToMessage(streamingMessage(), {
      type: "result",
      data: [{ region: "华北", amount: 41099.5 }],
    });
    expect(next.status).toBe("done");
    expect(next.result).toHaveLength(1);
  });

  it("sql 与 query_context 事件补充溯源字段", () => {
    let message = applyAgentEventToMessage(streamingMessage(), {
      type: "query_context",
      original_query: "华北销售",
      resolved_query: "统计华北地区的销售总额",
    });
    message = applyAgentEventToMessage(message, {
      type: "sql",
      sql: "SELECT 1",
    });
    expect(message.resolvedQuery).toBe("统计华北地区的销售总额");
    expect(message.sql).toBe("SELECT 1");
  });

  it("assistant_message 事件收敛为 done 并带建议问题", () => {
    const next = applyAgentEventToMessage(streamingMessage(), {
      type: "assistant_message",
      message: "我是数分助手",
      category: "capability_help",
      suggested_queries: ["统计销售额"],
    });
    expect(next.status).toBe("done");
    expect(next.content).toBe("我是数分助手");
    expect(next.suggestedQueries).toEqual(["统计销售额"]);
  });

  it("未知错误事件收敛为 error 且不透出原始细节", () => {
    const next = applyAgentEventToMessage(streamingMessage(), {
      type: "error",
      code: "query_failed",
      message: "查询处理失败，请稍后重试。",
    });
    expect(next.status).toBe("error");
    expect(next.content).toBe("这次查询没有成功。");
    expect(next.error).toBe("查询处理失败，请稍后重试。");
  });
});
