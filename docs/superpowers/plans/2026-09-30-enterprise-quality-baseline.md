# Enterprise Quality Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为现有问数系统建立一个不依赖真实付费模型、能够精确核对业务结果、覆盖 20 轮追问与会话隔离，并在 GitHub Actions 中生成可审计报告的企业级质量基线。

**Architecture:** 保留现有在线评测入口，把事件断言、用例加载和报告汇总提取为纯函数；在线 HTTP 客户端与确定性回放客户端共用同一评测内核。CI 使用固定 SSE 事件回放验证 API/评测契约并生成报告，真实 Docker/模型评测继续作为受控验收运行；当前尚未具备的结构化摘要、租户隔离和 20 轮真实模型正确率必须作为已知缺口出现在报告中，而不能被确定性回放冒充为已实现能力。

**Tech Stack:** Python 3.14、`unittest`、FastAPI/TestClient、现有 SSE JSON 协议、GitHub Actions、JSON 评测夹具。

**Spec:** `docs/superpowers/specs/2026-09-30-enterprise-query-reliability-and-data-portability-design.md`

## Global Constraints

- 本计划只实现设计文档“PR 1：企业级质量基线”，分支固定为 `feat/enterprise-quality-baseline`。
- 不修改 LangGraph 查询节点、Prompt、生产 SQL 生成逻辑、数据库结构或任何现有业务数据。
- 所有 CI 强制门槛必须确定性运行，不访问真实 LLM、Embedding、MySQL、Qdrant 或 Elasticsearch。
- 真实模型/Docker 评测不得伪装成 CI 通过项；报告必须区分 `deterministic_contract` 与 `live_system`。
- 20 轮场景必须恰好包含 20 次请求，其中至少 10 次通过 `resolved_query_contains` 明确依赖前文。
- 精确结果断言必须比较完整结果值；不能只检查 SQL 文本或事件类型。
- 隔离基线必须覆盖同用户不同会话、不同用户相同会话 ID；`tenant_id` 尚未进入现有运行上下文，必须登记为阻塞后续企业化验收的已知缺口。
- 任何新生成的报告写入 `evals/reports/` 并由 CI 上传为 artifact，不把每次运行产生的报告提交到 Git。
- 后端验证命令统一使用 `uv run python -m unittest discover -s tests -v`，不引入 pytest。
- PR 描述必须包含测试证据、数据影响、风险和回滚方法；未经用户审查不得合并。

---

## File Structure

### 新增文件

- `app/evaluation/__init__.py`：导出稳定的评测公共接口。
- `app/evaluation/assertions.py`：从 SSE 事件中提取终态并执行精确结果、上下文、SQL 和分析断言。
- `app/evaluation/cases.py`：加载并校验 JSON 用例，集中定义合法断言字段和覆盖率规则。
- `app/evaluation/seed.py`：将现有 `docker/mysql/dw.sql` 固定为可校验的数据快照。
- `app/evaluation/runner.py`：驱动多场景、多用户、多会话执行并生成逐轮报告；通过协议接口解耦 HTTP 与回放数据源。
- `app/evaluation/reporting.py`：汇总确定性结果、在线结果与已知缺口，写出稳定 JSON 报告。
- `app/scripts/run_enterprise_baseline.py`：CI 和本地统一命令入口。
- `evals/enterprise_baseline_cases.json`：20 轮追问和隔离场景的期望契约。
- `evals/fixtures/enterprise_seed_manifest.json`：种子 SQL 的规范化哈希和表行数清单。
- `evals/fixtures/enterprise_baseline_events.json`：与用例一一对应的固定 SSE 事件。
- `evals/enterprise_known_gaps.json`：当前未实现能力及关闭条件。
- `tests/test_evaluation_assertions.py`：纯断言单元测试。
- `tests/test_evaluation_cases.py`：用例 Schema 与覆盖率测试。
- `tests/test_evaluation_seed.py`：种子数据指纹防漂移测试。
- `tests/test_evaluation_runner.py`：会话复用、用户隔离和回放失败定位测试。
- `tests/test_enterprise_baseline.py`：完整确定性基线验收测试。

### 修改文件

- `app/scripts/evaluate_query_api.py`：保留 CLI 参数和 HTTP 登录/调用，只把断言与运行委托给新的评测内核。
- `tests/test_query_evaluator.py`：改为覆盖 HTTP/SSE 适配层，删除已迁移到纯评测模块的重复断言。
- `app/scripts/quality_check.py`：在后端单元测试后运行企业基线命令。
- `.github/workflows/ci.yml`：生成并上传企业基线 JSON artifact。
- `evals/README.md`：说明确定性基线、真实系统评测的边界和执行方法。
- `.gitignore`：确保 `evals/reports/*.json` 不进入版本控制，并保留目录占位文件。
- `tests/test_quality_check.py`：统一质量命令的调用顺序测试。

---

### Task 1: 提取可复用的精确事件断言

**Files:**
- Create: `app/evaluation/__init__.py`
- Create: `app/evaluation/assertions.py`
- Create: `tests/test_evaluation_assertions.py`
- Modify: `app/scripts/evaluate_query_api.py`
- Modify: `tests/test_query_evaluator.py`

**Interfaces:**
- Consumes: 当前 SSE 事件 `list[dict]` 与 JSON 用例中的 `expected: dict`。
- Produces: `evaluate_events(events: list[dict], expected: dict) -> tuple[bool, list[str]]`；后续在线与回放 runner 只能调用这一入口。

- [ ] **Step 1: 写出精确结果断言的失败测试**

```python
from app.evaluation.assertions import evaluate_events


class EvaluationAssertionTests(unittest.TestCase):
    def test_exact_result_detects_wrong_value(self):
        events = [
            {"type": "result", "data": [{"region": "华东", "sales": 17998}]},
            {"type": "analysis", "summary": "华东销售额为 17,998", "chart": None},
        ]
        passed, errors = evaluate_events(
            events,
            {
                "terminal_type": "result",
                "result_equals": [{"region": "华东", "sales": 18000}],
            },
        )
        self.assertFalse(passed)
        self.assertIn("result_equals", errors[0])

    def test_exact_result_normalizes_decimal_strings(self):
        events = [{"type": "result", "data": [{"sales": "17998.00"}]}]
        passed, errors = evaluate_events(
            events,
            {"terminal_type": "result", "result_equals": [{"sales": 17998}]},
        )
        self.assertTrue(passed, errors)

    def test_unordered_results_are_sorted_by_declared_keys(self):
        events = [{"type": "result", "data": [{"region": "华北", "sales": 2}, {"region": "华东", "sales": 1}]}]
        passed, errors = evaluate_events(
            events,
            {
                "terminal_type": "result",
                "result_equals": [{"region": "华东", "sales": 1}, {"region": "华北", "sales": 2}],
                "result_order_by": ["region"],
            },
        )
        self.assertTrue(passed, errors)
```

- [ ] **Step 2: 运行测试并确认因为模块不存在而失败**

Run: `uv run python -m unittest tests.test_evaluation_assertions -v`

Expected: FAIL，包含 `ModuleNotFoundError: No module named 'app.evaluation'`。

- [ ] **Step 3: 实现数值规范化、事件提取和精确比较**

`app/evaluation/assertions.py` 的公共实现必须包含以下签名和行为：

```python
from decimal import Decimal, InvalidOperation
from typing import Any


def _normalize(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, int | float | Decimal):
        return Decimal(str(value)).normalize()
    if isinstance(value, str):
        try:
            return Decimal(value.replace(",", "")).normalize()
        except InvalidOperation:
            return value
    if isinstance(value, list):
        return [_normalize(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize(item) for key, item in value.items()}
    return value


def last_event(events: list[dict], event_type: str) -> dict | None:
    return next(
        (event for event in reversed(events) if event.get("type") == event_type),
        None,
    )


def evaluate_events(
    events: list[dict], expected: dict
) -> tuple[bool, list[str]]:
    """返回是否通过及所有可操作错误，不在首个错误处提前退出。"""
```

实现必须继续支持现有字段：`terminal_type`、`terminal_type_any`、`resolved_query_contains`、`sql_contains`、`sql_not_contains`；新增 `result_equals`、`result_order_by`、`analysis_summary_contains`。`result_order_by` 不存在时保持数据库返回顺序，存在时按声明字段组成的 tuple 排序后比较。

- [ ] **Step 4: 运行精确断言测试并确认通过**

Run: `uv run python -m unittest tests.test_evaluation_assertions -v`

Expected: PASS，至少覆盖错误值、数字字符串、顺序规范化、缺少终态和分析摘要五类行为。

- [ ] **Step 5: 将在线评测切换到公共断言入口**

在 `app/scripts/evaluate_query_api.py` 中移除本地 `evaluate_turn` 实现，改为：

```python
from app.evaluation.assertions import evaluate_events

# evaluate_cases 的逐轮循环内
passed, errors = evaluate_events(events, turn["expected"])
```

在 `tests/test_query_evaluator.py` 中保留 `validate_base_url`、`parse_sse_events`、HTTP 参数和报告汇总的适配层测试；所有断言语义测试迁移到 `tests/test_evaluation_assertions.py`。

- [ ] **Step 6: 运行现有评测与新增断言测试**

Run: `uv run python -m unittest tests.test_query_evaluator tests.test_evaluation_assertions -v`

Expected: PASS；现有 `query_cases.json` 和 `query_cases_p3.json` 无需修改即可继续加载。

- [ ] **Step 7: 提交断言内核**

```bash
git add app/evaluation/__init__.py app/evaluation/assertions.py app/scripts/evaluate_query_api.py tests/test_evaluation_assertions.py tests/test_query_evaluator.py
git commit -m "test: add exact query result assertions"
```

---

### Task 2: 建立严格用例 Schema 与 20 轮覆盖率规则

**Files:**
- Create: `app/evaluation/cases.py`
- Create: `app/evaluation/seed.py`
- Create: `tests/test_evaluation_cases.py`
- Create: `tests/test_evaluation_seed.py`
- Create: `evals/enterprise_baseline_cases.json`
- Create: `evals/fixtures/enterprise_seed_manifest.json`

**Interfaces:**
- Consumes: `Path` 指向 UTF-8 JSON 数组，以及当前 `docker/mysql/dw.sql`。
- Produces: `load_cases(path: Path) -> list[dict]`、`validate_cases(cases: list[dict]) -> list[str]`、`coverage_summary(cases: list[dict]) -> dict[str, int]`、`verify_seed_manifest(manifest_path: Path, repository_root: Path) -> list[str]`。

- [ ] **Step 1: 写出非法断言字段与覆盖率不足的失败测试**

```python
from app.evaluation.cases import coverage_summary, load_cases, validate_cases


class EvaluationCaseTests(unittest.TestCase):
    def test_unknown_expected_key_is_rejected(self):
        errors = validate_cases([
            {"id": "bad", "kind": "single_turn", "turns": [
                {"query": "销售额", "expected": {"magic": 1}}
            ]}
        ])
        self.assertTrue(any("magic" in error for error in errors))

    def test_enterprise_context_case_requires_twenty_turns(self):
        errors = validate_cases([
            {"id": "context-20", "kind": "context_20_turn", "turns": [
                {"query": "销售额", "expected": {"terminal_type": "result"}}
            ]}
        ])
        self.assertTrue(any("20" in error for error in errors))

    def test_coverage_counts_context_dependent_turns(self):
        cases = load_cases(Path("evals/enterprise_baseline_cases.json"))
        summary = coverage_summary(cases)
        self.assertEqual(summary["context_20_turn_cases"], 1)
        self.assertEqual(summary["max_turns_in_case"], 20)
        self.assertGreaterEqual(summary["context_dependent_turns"], 10)
        self.assertGreaterEqual(summary["exact_result_turns"], 20)
```

- [ ] **Step 2: 运行测试并确认模块不存在或规则缺失**

Run: `uv run python -m unittest tests.test_evaluation_cases -v`

Expected: FAIL，原因是 `app.evaluation.cases` 或基线 JSON 尚不存在。

- [ ] **Step 3: 实现严格校验器**

`app/evaluation/cases.py` 必须声明允许字段并返回全部错误：

```python
ALLOWED_KINDS = {"single_turn", "context_20_turn", "session_isolation"}
ALLOWED_EXPECTED_KEYS = {
    "terminal_type",
    "terminal_type_any",
    "resolved_query_contains",
    "sql_contains",
    "sql_not_contains",
    "result_equals",
    "result_order_by",
    "analysis_summary_contains",
}


def validate_cases(cases: list[dict]) -> list[str]:
    """校验唯一 ID、场景类型、turn/query/expected 结构和企业覆盖约束。"""


def load_cases(path: Path) -> list[dict]:
    cases = json.loads(path.read_text(encoding="utf-8"))
    errors = validate_cases(cases)
    if errors:
        raise ValueError("\n".join(errors))
    return cases
```

对 `kind == "context_20_turn"` 强制恰好 20 轮、至少 10 轮含 `resolved_query_contains`、每轮含 `result_equals`；对 `kind == "session_isolation"` 强制存在非空 `username` 与 `session_key`。

- [ ] **Step 4: 写入明确的 20 轮业务链路用例**

`evals/enterprise_baseline_cases.json` 的 `context-20-turn-sales-analysis` 依次使用以下问题，不得用循环在运行时生成：

```text
1. 统计 2025 年销售总额
2. 按大区拆分
3. 只看华东
4. 换成销量
5. 按品类拆分
6. 只看手机数码
7. 按品牌拆分
8. 取前三名
9. 改看销售额
10. 和华南对比
11. 按月份展示
12. 只看第一季度
13. 改成订单量
14. 按会员等级拆分
15. 只看铂金会员
16. 按性别拆分
17. 再看平均客单价
18. 按省份排序
19. 取最高的两个省份
20. 汇总刚才筛选条件下的销售额
```

第 2～20 轮中至少第 2、3、4、5、6、7、8、9、10、11、12、13、14、15、16、17、18、19、20 轮声明 `resolved_query_contains`；每轮声明固定 `result_equals`。另增加四个 `session_isolation` 场景，使用 `alice/shared`、`alice/second`、`bob/shared`、`bob/second`，使相同 session ID 和相同用户两个方向都得到覆盖。

- [ ] **Step 5: 固定当前数仓种子快照**

`evals/fixtures/enterprise_seed_manifest.json` 写入以下内容；哈希按 UTF-8、无 BOM、换行统一为 `\n` 后计算：

```json
{
  "schema_version": 1,
  "source": "docker/mysql/dw.sql",
  "normalized_sha256": "a1f8d05da45ca8ceb988638cf64095b9409c6e5e41521c0f15910bc9555081a6",
  "table_rows": {
    "dim_region": 6,
    "dim_customer": 20,
    "dim_product": 15,
    "dim_date": 90,
    "fact_order": 115
  }
}
```

`app/evaluation/seed.py` 实现：

```python
def normalized_sha256(path: Path) -> str:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def verify_seed_manifest(
    manifest_path: Path, repository_root: Path
) -> list[str]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    actual = normalized_sha256(repository_root / manifest["source"])
    expected = manifest["normalized_sha256"]
    return [] if actual == expected else [
        f"seed hash changed: expected {expected}, got {actual}"
    ]
```

`tests/test_evaluation_seed.py` 断言当前 SQL 指纹通过；复制 SQL 到临时目录并追加一条空行后，断言返回 `seed hash changed`。这使任何种子变化都必须伴随精确结果和清单的人工复核。

- [ ] **Step 6: 运行 Schema、覆盖率与种子指纹测试**

Run: `uv run python -m unittest tests.test_evaluation_cases tests.test_evaluation_seed -v`

Expected: PASS；摘要显示一个 20 轮场景、至少 10 个上下文依赖轮次、至少 20 个精确结果轮次和四个隔离场景。

- [ ] **Step 7: 提交用例契约与种子指纹**

```bash
git add app/evaluation/cases.py app/evaluation/seed.py tests/test_evaluation_cases.py tests/test_evaluation_seed.py evals/enterprise_baseline_cases.json evals/fixtures/enterprise_seed_manifest.json
git commit -m "test: define enterprise evaluation scenarios"
```

---

### Task 3: 用确定性回放驱动统一评测 Runner

**Files:**
- Create: `app/evaluation/runner.py`
- Create: `tests/test_evaluation_runner.py`
- Create: `evals/fixtures/enterprise_baseline_events.json`
- Modify: `app/scripts/evaluate_query_api.py`

**Interfaces:**
- Consumes: `QueryClient.run_turn(query, username, session_id, turn_index) -> list[dict]`。
- Produces: `run_cases(cases, client, session_id_factory) -> list[dict]`；每条记录固定包含 `case_id`、`kind`、`username`、`session_id`、`turn`、`query`、`passed`、`errors`、`events`。

- [ ] **Step 1: 写出会话复用与用户隔离的失败测试**

```python
class RecordingClient:
    def __init__(self):
        self.calls = []

    def run_turn(self, query, username, session_id, turn_index):
        self.calls.append((query, username, session_id, turn_index))
        return [{"type": "result", "data": [{"value": turn_index}]}]


class EvaluationRunnerTests(unittest.TestCase):
    def test_turns_in_one_case_share_session(self):
        client = RecordingClient()
        report = run_cases(TWO_TURN_CASE, client, lambda case: f"session-{case['id']}")
        self.assertEqual(client.calls[0][2], client.calls[1][2])
        self.assertEqual([item["turn"] for item in report], [1, 2])

    def test_explicit_session_key_is_namespaced_by_username(self):
        client = RecordingClient()
        run_cases(ISOLATION_CASES, client, lambda case: case["session_key"])
        identities = {(call[1], call[2]) for call in client.calls}
        self.assertIn(("alice", "shared"), identities)
        self.assertIn(("bob", "shared"), identities)
        self.assertEqual(len(identities), 4)
```

- [ ] **Step 2: 运行测试并确认 runner 尚不存在**

Run: `uv run python -m unittest tests.test_evaluation_runner -v`

Expected: FAIL，包含 `ImportError` 或 `ModuleNotFoundError`。

- [ ] **Step 3: 定义客户端协议与纯 runner**

```python
from collections.abc import Callable
from typing import Protocol


class QueryClient(Protocol):
    def run_turn(
        self,
        query: str,
        username: str,
        session_id: str,
        turn_index: int,
    ) -> list[dict]: ...


def run_cases(
    cases: list[dict],
    client: QueryClient,
    session_id_factory: Callable[[dict], str],
) -> list[dict]:
    """同一 case 复用会话；每一轮通过 evaluate_events 形成可审计记录。"""
```

`run_cases` 不得登录、读环境变量或写文件；这些副作用属于适配器和 CLI。

- [ ] **Step 4: 增加固定事件回放客户端**

在 `app/evaluation/runner.py` 中增加：

```python
class ReplayQueryClient:
    def __init__(self, fixture: dict[str, list[list[dict]]]):
        self._fixture = fixture

    def run_turn(self, query, username, session_id, turn_index):
        key = f"{username}:{session_id}"
        try:
            return self._fixture[key][turn_index - 1]
        except (KeyError, IndexError) as error:
            raise LookupError(
                f"missing replay events for {key} turn {turn_index}"
            ) from error
```

`evals/fixtures/enterprise_baseline_events.json` 必须为 20 轮链路和四个隔离场景提供完整事件：`query_context`、`sql`、`result`、`analysis`。事件中的结果与 Task 2 的 `result_equals` 完全一致；故意变更任意金额时测试必须失败并指出 case ID 与轮次。

- [ ] **Step 5: 将现有 HTTP 调用封装为同一协议**

`app/scripts/evaluate_query_api.py` 新增 `HttpQueryClient`：首次遇到用户时调用现有 `login` 并缓存 token，`run_turn` 调用现有 `call_query`。CLI 使用 `run_cases`，保留现有参数和默认账号行为。

- [ ] **Step 6: 运行 runner 和旧在线适配层测试**

Run: `uv run python -m unittest tests.test_evaluation_runner tests.test_query_evaluator -v`

Expected: PASS；无网络访问、无 Docker 依赖。

- [ ] **Step 7: 提交统一 runner 与回放夹具**

```bash
git add app/evaluation/runner.py app/scripts/evaluate_query_api.py tests/test_evaluation_runner.py tests/test_query_evaluator.py evals/fixtures/enterprise_baseline_events.json
git commit -m "test: add deterministic enterprise evaluation runner"
```

---

### Task 4: 验证 API 会话键并登记不可伪装的基线缺口

**Files:**
- Create: `tests/test_enterprise_baseline.py`
- Create: `evals/enterprise_known_gaps.json`

**Interfaces:**
- Consumes: 现有 `QueryService.query(query, session_id, user)`、`get_graph()` 调用和 `UserIdentity`。
- Produces: 对当前线程键 `username:session_id` 的回归证据；生产代码零修改。

- [ ] **Step 1: 写出捕获 LangGraph thread ID 的服务测试**

```python
class CapturingGraph:
    def __init__(self):
        self.thread_ids = []

    async def astream(self, *, input, config, context, stream_mode):
        self.thread_ids.append(config["configurable"]["thread_id"])
        yield {"type": "result", "data": []}


class QueryServiceIsolationTests(unittest.TestCase):
    def test_username_and_session_form_current_isolation_key(self):
        graph = CapturingGraph()
        service = build_service_with_fakes()

        async def run():
            with patch("app.services.query_service.get_graph", return_value=graph):
                await collect(service.query("销售额", "shared", ALICE))
                await collect(service.query("销售额", "second", ALICE))
                await collect(service.query("销售额", "shared", BOB))

        asyncio.run(run())
        self.assertEqual(
            graph.thread_ids,
            ["alice:shared", "alice:second", "bob:shared"],
        )
```

`build_service_with_fakes()` 给 `QueryService` 的六个构造参数传入 `object()`；`collect()` 完整消费异步生成器。测试 patch 全局 `query_audit_service` 为内存新实例，避免触碰开发者 SQLite 文件。

- [ ] **Step 2: 运行隔离测试并确认现有行为**

Run: `uv run python -m unittest tests.test_enterprise_baseline.QueryServiceIsolationTests -v`

Expected: PASS；证明现有 username/session 两级隔离，不能把它描述成 tenant/user/session 三级隔离。

- [ ] **Step 3: 写入结构化已知缺口清单**

`evals/enterprise_known_gaps.json` 必须使用以下稳定 ID 和关闭条件：

```json
[
  {
    "id": "GAP-001",
    "capability": "20-turn-live-model-correctness",
    "status": "open",
    "evidence": "Only deterministic replay is enforced in CI; live model accuracy is not yet proven.",
    "close_when": "The live Docker evaluation passes all 20 turns with at least 10 context-dependent follow-ups and exact result assertions."
  },
  {
    "id": "GAP-002",
    "capability": "structured-context-compression",
    "status": "open",
    "evidence": "rewrite_query keeps only the latest 10 successful messages and has no structured summary.",
    "close_when": "PR 2 persists a schema-validated summary and proves bounded prompt input after 20 turns."
  },
  {
    "id": "GAP-003",
    "capability": "tenant-user-session-isolation",
    "status": "open",
    "evidence": "The current LangGraph thread key is username:session_id and contains no tenant_id.",
    "close_when": "PR 2 uses tenant_id:username:session_id and passes cross-tenant isolation tests."
  }
]
```

- [ ] **Step 4: 增加缺口清单防漂移测试**

在 `tests/test_enterprise_baseline.py` 断言三个 ID 唯一、状态只能是 `open`/`closed`、`evidence` 和 `close_when` 非空；额外断言 GAP-003 保持 `open`，直到生产线程键真的包含 tenant ID。

- [ ] **Step 5: 运行完整基线测试**

Run: `uv run python -m unittest tests.test_enterprise_baseline -v`

Expected: PASS；输出明确区分“已验证的两级隔离”和“未实现的三级隔离”。

- [ ] **Step 6: 提交会话证据与缺口清单**

```bash
git add tests/test_enterprise_baseline.py evals/enterprise_known_gaps.json
git commit -m "test: record enterprise reliability baseline gaps"
```

---

### Task 5: 生成可审计基线报告

**Files:**
- Create: `app/evaluation/reporting.py`
- Create: `app/scripts/run_enterprise_baseline.py`
- Modify: `tests/test_enterprise_baseline.py`

**Interfaces:**
- Consumes: `run_cases` 的逐轮记录、覆盖率摘要、已知缺口 JSON。
- Produces: `build_report(...) -> dict` 和 CLI 文件 `evals/reports/enterprise-baseline.json`。

- [ ] **Step 1: 写出报告不能隐藏失败和已知缺口的失败测试**

```python
class EnterpriseReportTests(unittest.TestCase):
    def test_report_separates_contract_passes_from_open_gaps(self):
        report = build_report(
            records=[{"case_id": "ok", "passed": True, "errors": []}],
            coverage={"max_turns_in_case": 20, "context_dependent_turns": 19},
            gaps=[{"id": "GAP-001", "status": "open"}],
            mode="deterministic_contract",
        )
        self.assertEqual(report["summary"]["failed_turns"], 0)
        self.assertEqual(report["summary"]["open_gap_ids"], ["GAP-001"])
        self.assertNotEqual(report["overall_status"], "enterprise_ready")

    def test_any_failed_turn_fails_contract_status(self):
        report = build_report(
            records=[{"case_id": "bad", "passed": False, "errors": ["wrong"]}],
            coverage={}, gaps=[], mode="deterministic_contract"
        )
        self.assertEqual(report["overall_status"], "failed")
```

- [ ] **Step 2: 运行报告测试并确认模块不存在**

Run: `uv run python -m unittest tests.test_enterprise_baseline.EnterpriseReportTests -v`

Expected: FAIL，包含 `ModuleNotFoundError` 或 `ImportError`。

- [ ] **Step 3: 实现稳定报告结构**

`build_report` 返回以下顶层字段：

```python
{
    "schema_version": 1,
    "mode": mode,
    "generated_at": datetime.now(UTC).isoformat(),
    "overall_status": "failed" | "baseline_passed_with_gaps" | "enterprise_ready",
    "summary": {
        "total_turns": int,
        "passed_turns": int,
        "failed_turns": int,
        "pass_rate": float,
        "failed_case_ids": list[str],
        "open_gap_ids": list[str],
    },
    "coverage": coverage,
    "known_gaps": gaps,
    "turns": records,
}
```

确定性回放全部通过但存在 open gap 时必须为 `baseline_passed_with_gaps`；只有 `mode == "live_system"`、全部轮次通过且没有 open gap 才允许 `enterprise_ready`。

- [ ] **Step 4: 实现无网络 CLI**

`python -m app.scripts.run_enterprise_baseline` 支持：

```text
--cases evals/enterprise_baseline_cases.json
--events evals/fixtures/enterprise_baseline_events.json
--gaps evals/enterprise_known_gaps.json
--report evals/reports/enterprise-baseline.json
```

CLI 加载用例和事件，使用 `ReplayQueryClient`、`run_cases`、`coverage_summary`、`build_report`，以 UTF-8 写报告；存在失败轮次时退出码为 1，全部确定性轮次通过时退出码为 0，即使仍有明确登记的 open gap。

- [ ] **Step 5: 运行 CLI 并检查报告事实**

Run: `uv run python -m app.scripts.run_enterprise_baseline --report evals/reports/enterprise-baseline.json`

Expected: 退出码 0；报告 `mode` 为 `deterministic_contract`、`failed_turns` 为 0、`max_turns_in_case` 为 20、`open_gap_ids` 为 `GAP-001`～`GAP-003`、`overall_status` 为 `baseline_passed_with_gaps`。

- [ ] **Step 6: 运行报告测试与完整后端测试**

Run: `uv run python -m unittest tests.test_enterprise_baseline -v`

Expected: PASS。

Run: `uv run python -m unittest discover -s tests -v`

Expected: 全部通过；不得访问外部网络或 Docker 服务。

- [ ] **Step 7: 提交报告生成能力**

```bash
git add app/evaluation/reporting.py app/scripts/run_enterprise_baseline.py tests/test_enterprise_baseline.py
git commit -m "test: generate auditable enterprise baseline report"
```

---

### Task 6: 接入本地质量命令、CI artifact 和运行文档

**Files:**
- Modify: `app/scripts/quality_check.py`
- Modify: `.github/workflows/ci.yml`
- Modify: `evals/README.md`
- Modify: `.gitignore`
- Create: `evals/reports/.gitkeep`

**Interfaces:**
- Consumes: Task 5 的 CLI。
- Produces: 本地一致质量门槛、GitHub Actions 报告 artifact、真实系统手工验收说明。

- [ ] **Step 1: 先给质量命令测试加入预期调用**

若现有 `quality_check.py` 没有命令编排测试，新建 `tests/test_quality_check.py`，patch `app.scripts.quality_check.run` 与 `shutil.which`，断言命令序列包含：

```python
[
    sys.executable,
    "-m",
    "app.scripts.run_enterprise_baseline",
    "--report",
    "evals/reports/enterprise-baseline.json",
]
```

- [ ] **Step 2: 运行测试并确认缺少基线命令而失败**

Run: `uv run python -m unittest tests.test_quality_check -v`

Expected: FAIL，实际命令列表中不存在 `run_enterprise_baseline`。

- [ ] **Step 3: 将确定性基线加入统一质量入口**

在后端 `unittest` 之后、前端测试之前增加：

```python
run([
    sys.executable,
    "-m",
    "app.scripts.run_enterprise_baseline",
    "--report",
    "evals/reports/enterprise-baseline.json",
])
```

- [ ] **Step 4: 将基线报告接入 GitHub Actions**

在 backend job 的 Unit tests 后加入：

```yaml
      - name: Enterprise deterministic baseline
        run: >-
          uv run python -m app.scripts.run_enterprise_baseline
          --report evals/reports/enterprise-baseline.json
      - name: Upload enterprise baseline report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: enterprise-baseline-${{ github.run_id }}
          path: evals/reports/enterprise-baseline.json
          if-no-files-found: error
```

不增加任何密钥，不在 CI 启动 Docker，不调用真实模型。

- [ ] **Step 5: 更新报告忽略规则与文档**

`.gitignore` 增加：

```gitignore
evals/reports/*.json
!evals/reports/.gitkeep
```

`evals/README.md` 必须分别给出：

```bash
# 无网络、PR 强制门槛
uv run python -m app.scripts.run_enterprise_baseline

# Docker 服务和真实模型均已启动后的受控评测
uv run python -m app.scripts.evaluate_query_api \
  --cases evals/enterprise_baseline_cases.json \
  --report evals/reports/enterprise-live.json
```

并明确：确定性报告证明断言、SSE 契约和会话编排可回归；它不证明真实 LLM 在 20 轮中已经正确，后者只有 live report 能关闭 GAP-001。

- [ ] **Step 6: 运行全部本地门槛**

Run: `uv run ruff check .`

Expected: PASS。

Run: `uv run python -m unittest discover -s tests -v`

Expected: 全部通过。

Run: `uv run python -m app.scripts.run_enterprise_baseline --report evals/reports/enterprise-baseline.json`

Expected: 退出码 0，报告为 `baseline_passed_with_gaps`。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 7: 提交 CI 与文档**

```bash
git add .github/workflows/ci.yml .gitignore app/scripts/quality_check.py evals/README.md evals/reports/.gitkeep tests/test_quality_check.py
git commit -m "ci: enforce enterprise query quality baseline"
```

---

## PR 验收与交付

- [ ] **Step 1: 复核变更边界**

Run: `git diff main...HEAD -- app/agent app/prompt prompts docker/mysql`

Expected: 无输出；本 PR 不修改 Agent、Prompt 或数据库初始化数据。

- [ ] **Step 2: 保存最终验证证据**

在 PR 描述中记录四条命令的实际结果：Ruff、完整 unittest、enterprise baseline、`git diff --check`。报告 artifact 必须能在 GitHub Actions 下载。

- [ ] **Step 3: 明确数据/API 影响**

PR 描述写明：数据库结构与数据无变化；生产 `/api/query` 协议无变化；在线评测 CLI 保持兼容；只新增测试/评测模块与 CI 质量门槛。

- [ ] **Step 4: 明确风险与回滚**

风险：夹具与真实系统可能漂移，因此报告保留 open gaps，真实模型评测独立执行。回滚：撤销该 PR 的提交即可，不需要数据库回滚。

- [ ] **Step 5: 推送并创建 PR**

```bash
git push -u origin feat/enterprise-quality-baseline
```

PR 标题：`test: 建立企业级查询质量基线`

PR 目标分支：只有在设计 PR #11 合并后才使用 `main`；若 #11 尚未合并，先停止创建功能 PR，不建立绕过设计评审的堆叠分支。

---

## Self-Review Record

- 规格覆盖：本计划覆盖 PR 1 要求的固定结果断言、20 轮场景、隔离场景、确定性 CI、真实模型评测边界、测试证据和回滚说明。
- 有意留给后续 PR：结构化摘要与三级隔离属于 PR 2；显式关系属于 PR 3；版本构建/切换属于 PR 4；QueryPlan 与可回答性属于 PR 5；数据集运维命令属于 PR 6。
- 完整性检查：计划不含空白任务或未定义接口；尚未实现的能力全部以稳定 gap ID 和关闭条件表达。
- 类型一致性：`evaluate_events`、`load_cases`、`coverage_summary`、`QueryClient.run_turn`、`run_cases`、`build_report` 在定义和后续调用中保持同一名称与参数顺序。
