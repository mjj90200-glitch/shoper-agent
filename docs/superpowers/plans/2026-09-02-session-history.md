# 会话恢复与查询历史（P4）

> 状态：浏览器侧当前会话恢复已完成；服务重启后的后端持久化被 SQLite checkpointer 依赖下载阻塞。

## 已完成

- 前端将当前 `sessionId` 和已完成的聊天消息保存到浏览器 `localStorage`；
- 刷新页面后，会恢复当前会话界面并继续使用同一 `session_id`；
- “新会话/清空”会清除浏览器缓存并生成新的 `session_id`。

## 当前边界

后端仍使用 `InMemorySaver`，因此仅当 FastAPI 服务未重启时，刷新后的追问才保留后端上下文。若服务重启，前端会保留已展示的历史，但不能保证 Agent 仍记得它。

## 待完成

- 安装 `langgraph-checkpoint-sqlite` 后，将 Checkpointer 改为 SQLite；
- 增加会话列表、重命名、删除和历史详情 API；
- 将会话归属绑定到用户认证，防止会话 ID 被猜测或串用。
