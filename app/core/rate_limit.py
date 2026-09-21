"""进程内限流与字符配额。

单进程部署下使用内存滑动窗口即可满足本地与受控内网场景；多副本部署时
应替换为基于 Redis 的实现（接口不变）。设计要点：
- 时钟由调用方注入，测试无需 sleep；
- 限流按 key（如 `scope:username`）隔离；
- 字符配额按自然日重置，剩余额度不足以完整外发时整体拒绝。
"""

import threading
from collections import defaultdict, deque


class SlidingWindowLimiter:
    """按 key 的滑动窗口限流器。"""

    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: str, now: float) -> bool:
        with self._lock:
            hits = self._hits[key]
            boundary = now - self.window_seconds
            while hits and hits[0] <= boundary:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True


class CharQuota:
    """按用户与自然日的字符外发配额。"""

    def __init__(self, daily_chars: int):
        self.daily_chars = daily_chars
        self._used: dict[tuple[str, str], int] = {}
        self._lock = threading.Lock()

    def used(self, key: str, day: str) -> int:
        with self._lock:
            return self._used.get((key, day), 0)

    def try_consume(self, key: str, chars: int, day: str) -> bool:
        if chars > self.daily_chars:
            return False
        with self._lock:
            bucket = (key, day)
            used = self._used.get(bucket, 0)
            if used + chars > self.daily_chars:
                return False
            self._used[bucket] = used + chars
            return True


# 各接口类的共享限流实例（P2-D）；配额为进程内实现，多副本部署时换 Redis
login_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
query_limiter = SlidingWindowLimiter(limit=20, window_seconds=60)
analysis_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
tts_limiter = SlidingWindowLimiter(limit=20, window_seconds=60)
tts_daily_quota = CharQuota(daily_chars=20000)
