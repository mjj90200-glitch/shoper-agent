/**
 * 问数 SSE 客户端测试：正常流、错误事件、取消与失败响应
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { streamQuery } from "./agentApi";
import type { AgentEvent } from "../types/agent";

function sseResponse(events: object[]) {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function okFetch(response: Response) {
  return vi.fn(async () => response);
}

const options = (events: AgentEvent[], signal?: AbortSignal) => ({
  sessionId: "s-1",
  accessToken: "token",
  signal,
  onEvent: (event: AgentEvent) => events.push(event),
});

describe("streamQuery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正常请求按序派发事件直到流结束", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch(
        sseResponse([
          { type: "progress", step: "生成SQL", status: "running" },
          { type: "result", data: [] },
        ]),
      ),
    );
    const events: AgentEvent[] = [];
    await streamQuery("统计销售额", options(events));
    expect(events.map((event) => event.type)).toEqual(["progress", "result"]);
  });

  it("SSE 错误事件作为普通事件派发且不抛异常", async () => {
    vi.stubGlobal(
      "fetch",
      okFetch(sseResponse([{ type: "error", code: "query_failed", message: "查询处理失败" }])),
    );
    const events: AgentEvent[] = [];
    await streamQuery("统计销售额", options(events));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
  });

  it("非 2xx 响应抛出带状态码的错误", async () => {
    vi.stubGlobal("fetch", okFetch(new Response("{}", { status: 500 })));
    const events: AgentEvent[] = [];
    await expect(streamQuery("统计销售额", options(events))).rejects.toThrow("HTTP 500");
  });

  it("请求被取消时抛出 AbortError", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            controller.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      ),
    );
    const events: AgentEvent[] = [];
    const pending = streamQuery("统计销售额", options(events, controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(events).toHaveLength(0);
  });
});
