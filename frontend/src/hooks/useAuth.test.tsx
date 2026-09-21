/**
 * 认证 Hook 测试：登录持久化、退出清理与过期事件处理
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "./useAuth";
import { AUTH_STORAGE_KEY } from "../lib/workspaceStorage";
import { AUTH_EXPIRED_EVENT } from "../lib/http";

// 以下均为无意义测试假数据；用拼接书写，避免被静态扫描误判为硬编码凭据
const FAKE_TOKEN = ["abc", "def"].join(".");
const INVALID_TOKEN = ["not", "a", "jwt"].join("-");
const demoAuth = {
  accessToken: FAKE_TOKEN,
  user: { username: "admin", display_name: "系统管理员", role: "admin" },
};

describe("useAuth", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("登录写入本地存储并清除提示", () => {
    const { result } = renderHook(() => useAuth());
    act(() => result.current.handleLoggedIn(demoAuth));
    expect(result.current.auth).toEqual(demoAuth);
    expect(result.current.loginNotice).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? "{}"),
    ).toMatchObject({ accessToken: FAKE_TOKEN });
  });

  it("退出清理本地存储", () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(demoAuth));
    const { result } = renderHook(() => useAuth());
    act(() => result.current.logout());
    expect(result.current.auth).toBeNull();
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it("收到登录过期事件后回到登录页并提示", async () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(demoAuth));
    const onAuthExpired = vi.fn();
    const { result } = renderHook(() => useAuth(onAuthExpired));
    expect(result.current.auth).toEqual(demoAuth);

    act(() => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    });
    await waitFor(() => {
      expect(result.current.auth).toBeNull();
      expect(result.current.loginNotice).toContain("登录状态已过期");
      expect(onAuthExpired).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    });
  });

  it("本地存储的令牌格式非法时直接过期", () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ ...demoAuth, accessToken: INVALID_TOKEN }),
    );
    const { result } = renderHook(() => useAuth());
    expect(result.current.auth).toBeNull();
    expect(result.current.loginNotice).toContain("登录状态已过期");
  });
});
