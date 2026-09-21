"""审计记录实体：一次问数请求的完整审计字段。"""

from dataclasses import asdict, dataclass, field
from time import perf_counter


@dataclass
class QueryAuditRecord:
    id: str
    username: str
    session_id: str
    query: str
    resolved_query: str | None
    sql: str | None
    result_row_count: int | None
    terminal_type: str | None
    status: str
    error: str | None
    feedback_score: str | None
    feedback_comment: str | None
    feedback_at: str | None
    started_at: str
    duration_ms: int | None
    # P3-B/C 可观测性：LangGraph 节点耗时（秒→毫秒）与稳定错误分类码
    error_code: str | None = None
    step_timings: dict[str, float] = field(default_factory=dict)
    _started_monotonic: float = 0.0
    _step_started: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        data = asdict(self)
        data.pop("_started_monotonic")
        data.pop("_step_started")
        return data

    def note_step_event(self, event: dict) -> None:
        """记录节点进度事件，形成步骤耗时观测。

        事件可携带毫秒时钟 ts（测试注入用）；缺省用进程性能时钟（自动转毫秒）。
        """

        step = str(event.get("step", ""))
        status = str(event.get("status", ""))
        if not step:
            return
        now_ms = float(event["ts"]) if "ts" in event else perf_counter() * 1000
        if status == "running":
            self._step_started[step] = now_ms
            return
        started = self._step_started.pop(step, None)
        if started is not None:
            self.step_timings[step] = round(now_ms - started, 1)
