/**
 * 统一 HTTP 客户端测试：401 触发登录过期事件与专用错误
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_EXPIRED_EVENT, AuthenticationExpiredError, authenticatedFetch } from "./http";

describe("authenticatedFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.removeEventListener(AUTH_EXPIRED_EVENT, () => {});
  });

  it("正常响应原样返回", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const result = await authenticatedFetch("http://127.0.0.1:8000/api/sessions");
    expect(result).toBe(response);
  });

  it("401 触发登录过期事件并抛出专用错误", async () => {
    const expiredHandler = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, expiredHandler);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ detail: "登录已失效" }), { status: 401 })),
    );

    await expect(authenticatedFetch("http://127.0.0.1:8000/api/sessions")).rejects.toBeInstanceOf(
      AuthenticationExpiredError,
    );
    expect(expiredHandler).toHaveBeenCalledTimes(1);
  });
});
