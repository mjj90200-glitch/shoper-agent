/**
 * 工作区纯函数测试：会话标题、审计记录转换与分析项目本地加载
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  deriveConversationTitle,
  loadAnalysisProjects,
  recordsToMessages,
  ANALYSIS_PROJECTS_STORAGE_KEY,
} from "./workspaceStorage";
import type { QueryAudit } from "../types/agent";

describe("deriveConversationTitle", () => {
  it("截断超过 28 字的问题", () => {
    const long = "一".repeat(40);
    expect(deriveConversationTitle(long)).toHaveLength(29);
    expect(deriveConversationTitle(long).endsWith("…")).toBe(true);
    expect(deriveConversationTitle("  统计 华北 销售额  ")).toBe("统计 华北 销售额");
  });
});

describe("recordsToMessages", () => {
  it("把审计记录转换为用户/助手成对消息", () => {
    const audit = {
      id: "a1",
      username: "admin",
      session_id: "s1",
      query: "统计销售额",
      resolved_query: "统计华北销售额",
      sql: "SELECT 1",
      result_row_count: 3,
      terminal_type: "result",
      status: "succeeded",
      error: null,
      started_at: "2026-09-20T10:00:00+00:00",
      duration_ms: 100,
    } as QueryAudit;
    const messages = recordsToMessages([audit]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "统计销售额" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      status: "done",
      content: "已返回 3 行结果",
      sql: "SELECT 1",
    });
  });
});

describe("loadAnalysisProjects", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("没有本地数据时返回空列表", () => {
    expect(loadAnalysisProjects()).toEqual([]);
  });

  it("过滤缺失必要字段的损坏记录并补默认值", () => {
    window.localStorage.setItem(
      ANALYSIS_PROJECTS_STORAGE_KEY,
      JSON.stringify([
        { id: "p1", title: "项目一", createdAt: 100, updatedAt: 200 },
        { title: "缺少 id 的记录" },
      ]),
    );
    const projects = loadAnalysisProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: "p1", status: "draft", runs: [] });
  });
});
