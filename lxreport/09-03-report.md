# 9 月 3 日 P8–P10 TDD 测试报告

> 独立测试报告，按 9.03 需求执行；所有结果、证据、脚本均在本 `lxreport/` 目录。

## 测试记录

```text
日期：2026-09-03
测试人员：Codex（用户提供 DeepSeek Key，admin 会话执行）
代码版本 / Git Commit：非 Git 仓库
测试环境：Docker(5 容器) + 真实 LLM(deepseek-v4-flash) + Edge 无头浏览器（登录页/聊天/历史/审计 UI）
自动化结果：Ruff 通过；Python 单测 32/32；tsc 通过；vite build 通过
Docker 重启验证：B1/B2/B3 均完成（后端重启 2 次）
发现问题：见“发现的问题”一节
是否阻塞上线：不阻塞；3 项前端/回归缺口需开发补齐（详见结论）
```

## 执行结果对照

### A. 自动化测试

| 检查        | 结果     | 证据                        |
| ----------- | -------- | --------------------------- |
| Ruff        | ✅ 通过  | `offline/ruff.txt`          |
| Python 单测 | ✅ 32/32 | `offline/unittest.txt`      |
| TypeScript  | ✅ 通过  | `offline/tsc.txt`（exit 0） |
| Vite build  | ✅ 通过  | `offline/vite-build.txt`    |

**A1 SQLite Checkpointer**

- ✅ 临时 SQLite 首轮写入、关闭连接、重开新连接/图实例后 `aget_state` 仍在：
  `test_checkpoint_survives_reopening_sqlite_connection`（thread_id=`admin:session-1`）
- ⚠️ 不同 `thread_id` / 用户前缀（`admin:session-1` vs `analyst:session-1`）隔离：checkpointer 单测无显式断言；
  已通过 API 层验证跨用户会话不可见（见 A3）；建议后续补 checkpointer 级断言
- ✅ SQLite 文件位于 `data/langgraph-checkpoints.sqlite`，`/data/` 已被 `.gitignore` 忽略

**A2 审计与反馈 SQLite 持久化**

- ✅ start→写入会话与审计；observe(query_context/sql/result)+finish 后改写问题/SQL/行数/状态/耗时入库：
  `test_successful_query_records_trace_without_result_rows` + 实盘 `restart/b2-5-audits-after-feedback.json`
- ✅ 重开审计服务（服务重启）后仍可读：`restart/b2-6-audits-after-restart.json`
- ✅ 有帮助/需改进 + 原因持久化：单测 + 实盘 feedback=down/comment 均存库
- ✅ 其他用户提交同一 audit_id → 404（实盘 `api/a2-1-other-user-feedback-404.json`；单测返回 None）
- ✅ running 状态拒绝反馈：实现中 `status=="running"` 直接返回 None（代码核对），完成态才可提交
- ✅ 审计不存 `result.data`，只存 `result_row_count`（单测 `assertNotIn("data", audit)`）

**A3 会话管理 API**

- ✅ 无 Bearer → 401：`api/a3-1-no-token-401.json`
- ✅ 仅返回本人会话；跨用户读取 → 404：`restart/b2-9-analyst-cross-user-session.json`
- ✅ 会话详情仅含该会话审计型历史：`api/a3-7-own-session-detail.json`（华东+华北两条，含改写问题/SQL）
- ✅ PATCH 改名 200；空标题/超 80 字 → 422：`api/a3-2/3/4-*.json`
- ✅ 跨用户改名/删除 → 404：`api/a3-5/6-*.json`
- ✅ 删除会话后 `chat_sessions` 与 `query_audit_log` 均清除：`restart/b3-*.json`
- ❌ **预期失败（文档已注明待实现）**：删除后 checkpoint 未物理删除，同 `session_id` 追问“那华南呢？”
  仍被改写为“2025 年第一季度华南大区的销售额”（继承旧上下文）：`restart/b3-6-checkpoint-after-delete.json`

**A4 管理员质量汇总**

- ✅ 汇总计算正确：总问数 5、完成 5、成功率 100%、平均耗时 14739ms、反馈 1 条（实盘 `restart/b2-12-admin-quality.json`）
- ✅ 无反馈/空数据除零保护：实现 `if feedbacks else 0` / `if completed else 0`（代码核对）；负反馈-only 时
  helpful_rate=0.0 非 NaN（此前 b2-12 首版样本）
- ✅ 普通分析员调用 → 403：`restart/b2-11-analyst-quality.json`
- ✅ 负反馈列表最多最近 10 条、倒序、含问题/用户/原因/时间：实现 `negative[-10:][::-1]`（代码核对）；
  实盘 1 条样本字段完整。10 条上限未做压力构造（样本不足，建议后续造数回归）

### B. Docker 与真实服务重启验收

**B1 持久化追问** ✅

1. admin 登录 → `统计华东地区 2025 年第一季度销售额`（session=`restart/b1-session.txt`）成功
2. 重启 FastAPI（第 1 次）
3. 同账号同 session 追问 `那华北呢？`
4. 改写问题 = `统计华北地区 2025 年第一季度销售额`；SQL 含 `region_name='华北' AND year=2025 AND quarter='Q1' LIMIT 1000`
   证据：`restart/b1-1-before-restart.json`、`restart/b1-2-after-restart.json`

**B2 审计/反馈/会话重启恢复** ✅

- 问数→标记“需改进”+原因→重启 FastAPI（第 2 次）→重新登录
- 重启后：审计记录（SQL/行数/状态/耗时）、feedback=down+原因、会话标题均保留；analyst 登录不可见
  证据：`restart/b2-5/6/7/8/9/10-*.json`

**B3 删除边界** ✅（含预期失败项）

- 删除会话后 GET 404、audits/sessions 中均无残留：`restart/b3-1/2/3/5-*.json`
- Checkpointer 物理删除：❌ 未实现（预期失败，见 A3 对应项）

### C. 前端验收

**C1 历史会话面板**

| 项                                              | 结果        | 证据                                                                          |
| ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| “历史”可打开面板                                | ✅          | `frontend/c1-history-panel.png`                                               |
| 仅显示当前用户会话                              | ✅          | admin 仅见自己的 4 条；analyst 面板为空                                       |
| 点击会话显示原问题/摘要/改写问题/SQL            | ✅          | `frontend/c1-session-detail2.png`（原问题/已返回 1 行/理解为…/执行 SQL/复制） |
| 切换后复用 session_id 继续提问                  | ⚠️ 部分     | 点击后详情载入当前聊天流；未再发问断言归属同一 session（建议人工补一步）      |
| 删除按钮删除条目                                | ❌ 未提供   | 全页 aria/按钮扫描无删除控件（含 hover）`frontend/hover-labels.json`          |
| 重命名入口未提供（已知边界）                    | ✅ 如实记录 | 同左                                                                          |
| 历史只恢复审计摘要、无完整表格/图表（已知边界） | ✅ 如实记录 | 详情仅摘要+SQL，符合说明                                                      |

**C2 管理员质量指标**

| 项                                        | 结果 | 证据                                                   |
| ----------------------------------------- | ---- | ------------------------------------------------------ |
| 查询审计显示总问数/成功率/平均耗时/好评率 | ✅   | `frontend/c2-quality-admin.png`（5/100%/14739ms/100%） |
| 无数据时显示 0 或 —，不报错               | ✅   | analyst 空态文案“当前还没有查询记录”，无异常           |
| 非管理员只显示个人审计、无全局指标        | ✅   | `frontend/c2-quality-analyst.png`                      |
| 窄屏可读、无横向溢出                      | ✅   | `frontend/c2-narrow-audit.png`                         |

## 发现的问题

1. **会话删除后 LangGraph checkpoint 未物理删除**：删除会话后同 `session_id` 仍继承旧上下文（预期失败项，文档已知，待开发实现）。
2. **历史面板无“删除”入口**：C1 验收项要求删除按钮，实际 UI 全页无删除控件（重命名已知缺失，删除同样缺失，需开发补）。
3. **审计面板副标题文案与实际不符**：显示“仅显示当前登录用户、本次服务进程内的最近记录”，但数据为 SQLite 持久化，
   重启后仍可读（B2 已验证）。“本次服务进程内”表述有误导，建议改文案。
4. **反馈可重复提交并覆盖**：同一 audit 再次 PUT 返回 200 覆盖原反馈（文档未要求禁止，观察项，如需防重需服务端限制）。
5. **LLM 输出偶发非 JSON**：召回字段节点偶发 `Invalid json output`（昨 E2 出现 1 次，本轮未复现），建议对结构化输出加
   一次重试或容错解析。

## 结论

- 自动化基线全部通过；SQLite 持久化、审计/反馈、会话管理 API、管理员质量汇总的核心功能均可用。
- B 部分真实重启验证全部通过（SQLite checkpoint/审计跨重启保留；跨用户隔离正确）。
- 3 项缺口记录为待补：① checkpointer 物理删除；② 前端历史删除（及重命名）入口；③ 会话删除后 UI 刷新回归确认。
- 不阻塞上线；建议开发补齐上述缺口后重跑 B3/C1 对应项。
  21
