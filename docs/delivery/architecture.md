# 架构与设计材料（P4-D）

> 面向技术面试与简历交付的一页式材料。全部图示与代码一一对应，可按图索骥。

## 1. 系统架构

```mermaid
flowchart TB
    subgraph client["浏览器"]
        UI["React 19 数据工作台<br/>hooks: useAuth / useConversations / useAgentStream / useAnalysisProjects"]
    end
    subgraph app["FastAPI 应用"]
        MW["请求追踪中间件<br/>X-Request-ID"]
        AUTH["认证/权限/限流"]
        API["REST + SSE 路由"]
        HEALTH["/health/live · /health/ready"]
        PLAN["分析计划与综合报告"]
    end
    subgraph agent["LangGraph 问数工作流（18 节点）"]
        G["意图分流 → 三路并行召回 → 过滤合并 → SQL 生成<br/>→ AST 安全校验 → 关键词纵深 → 数据权限 → 只读执行 → 结果分析"]
    end
    UI -->|REST / SSE| MW --> AUTH --> API
    API --> HEALTH
    API --> PLAN
    API --> G
    G --> LLM["OpenAI 兼容大模型"]
    G --> META[("MySQL meta 元数据")]
    G --> VEC[("Qdrant 字段/指标向量")]
    G --> SRCH[("Elasticsearch 字段取值")]
    G --> DW[("MySQL dw 数仓<br/>只读账号 dw_reader")]
    AUTH --> STATE[("SQLite 会话/审计/项目")]
    PLAN --> STATE
    API --> TTS["火山引擎豆包 V3<br/>限流 + 每日外发配额"]
```

## 2. LangGraph 执行图

```mermaid
flowchart LR
    S((START)) --> RQ[rewrite_query] --> CI{classify_intent}
    CI -- 非数据/能力咨询 --> ND[respond_non_data] --> E1((END))
    CI -- 数据查询 --> KW[extract_keywords]
    KW --> RC[recall_column] & RV[recall_value] & RM[recall_metric]
    RC & RV & RM --> MG[merge_retrieved_info]
    MG --> FT[filter_table] & FM[filter_metric]
    FT & FM --> AC[add_extra_context] --> GS[generate_sql] --> GU{guard_sql}
    GU -- 拒绝 --> RJ[respond_sql_rejected] --> E2((END))
    GU -- 通过 --> VA{validate_sql}
    VA -- 通过 --> RUN[run_sql] --> AN[analyze_result] --> E3((END))
    VA -- 失败且未重试 --> CO[correct_sql] --> GU
    VA -- 重试耗尽 --> RJ
```

多轮记忆由 SQLite Checkpointer 持久化（thread = `username:session_id`）。

## 3. 数仓 ER 图（星型模型）

```mermaid
erDiagram
    fact_order ||--o{ dim_date : date_id
    fact_order }o--|| dim_region : region_id
    fact_order }o--|| dim_product : product_id
    fact_order }o--|| dim_customer : customer_id

    fact_order {
        varchar order_id PK
        varchar customer_id
        varchar product_id
        int date_id
        varchar region_id
        int order_quantity
        float order_amount
    }
    dim_date {
        int date_id PK
        int year
        varchar quarter
        int month
        int day
    }
    dim_region {
        varchar region_id PK
        varchar province
        varchar region_name
        varchar country
    }
    dim_product {
        varchar product_id PK
        varchar product_name
        varchar category
        varchar brand
    }
    dim_customer {
        varchar customer_id PK
        varchar customer_name
        varchar gender
        varchar member_level
    }
```

## 4. 一次问数的时序

```mermaid
sequenceDiagram
    participant B as 浏览器
    participant A as FastAPI
    participant G as LangGraph
    participant R as 检索(Qdrant/ES/MySQL)
    participant D as MySQL dw(只读)
    participant L as 大模型

    B->>A: POST /api/query (Bearer, SSE)
    A->>A: 限流 20/min · request_id 注入
    A->>G: astream(state, context)
    G->>L: 意图识别/改写
    G->>R: 三路并行召回（字段/指标/取值）
    R-->>G: 候选表/字段/指标
    G->>L: 生成 SQL
    G->>G: AST 校验→关键词→数据权限（自动注入地区范围）
    G->>D: 只读执行（15s 超时）
    D-->>G: 结果集
    G-->>A: progress/sql/result/analysis 事件流
    A-->>B: SSE 逐事件下发（审计旁路记录）
```

## 5. SQL 安全设计（P2）

四层纵深，任何一层拦截即终止：

| 层 | 机制 | 拦截目标 |
| --- | --- | --- |
| 1. AST 结构校验（sqlglot） | 仅单条 SELECT/CTE；白名单 dw 库；拒系统库/写操作/文件/变量/危险函数；JOIN≤6、子查询≤4 | 语法层绕过、越库、资源攻击 |
| 2. 关键词扫描（保留） | 文本黑名单 + 括号/字符串完整性 | 纵深防御 |
| 3. 数据权限（AST 注入） | 区域经理自动包装 `region_name IN (授权地区)`；敏感列按字段标识拒绝 | 越权行/列 |
| 4. 数据库账号 | `dw_reader` 仅 SELECT dw.*，15s 语句超时 | 兜底：应用层全失效也写不了 |

验证：80 场景 85 轮评测含 13 个安全终态用例；`dw_reader` 实测 INSERT/UPDATE/DELETE/CREATE 全部 ERROR 1142。

## 6. 可观测性与质量指标（P3）

- 每请求 `X-Request-ID` 贯穿日志、错误信封与响应头。
- `/health/ready` 聚合五依赖就绪状态（healthy/degraded/unavailable）。
- 审计记录节点耗时（`step_timings`）与稳定错误码（`error_code`）。
- 管理员质量摘要：成功率、成功查询 P50/P95 延迟、按码分类的失败分布、反馈率。

## 7. 工程质量基线（v0.3 阶段）

- 后端 136 测试 / 前端 20 测试全绿；Ruff；tsc + Vite 构建；GitHub Actions 双 Job。
- 一条 `docker compose --profile app up -d --build` 启动全栈，已实测端到端问数。
