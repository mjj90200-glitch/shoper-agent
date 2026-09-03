# 会话恢复与查询历史（P4）

> 状态：浏览器侧当前会话恢复与 SQLite Checkpointer 持久化已完成；历史会话管理尚未实现。

## 已完成

- 前端将当前 `sessionId` 和已完成的聊天消息保存到浏览器 `localStorage`；
- 刷新页面后，会恢复当前会话界面并继续使用同一 `session_id`；
- “新会话/清空”会清除浏览器缓存并生成新的 `session_id`。
- FastAPI 生命周期内使用 `AsyncSqliteSaver` 持有 `data/langgraph-checkpoints.sqlite`；服务重启后可恢复同一用户同一 `session_id` 的 LangGraph 状态。

## 当前边界

后端 API 已使用 SQLite 保存 LangGraph 状态；前端仍只保存当前浏览器会话。历史会话列表、重命名和删除尚未实现。

## 待完成

- 增加会话列表、重命名、删除和历史详情 API；
- 将会话归属绑定到用户认证，防止会话 ID 被猜测或串用。
