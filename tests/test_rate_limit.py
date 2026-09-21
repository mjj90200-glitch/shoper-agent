"""限流与 TTS 字符配额测试（注入时钟，不依赖真实时间）。"""

import unittest

from app.core.rate_limit import CharQuota, SlidingWindowLimiter


class SlidingWindowLimiterTests(unittest.TestCase):
    def test_allows_requests_within_limit(self):
        limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
        for i in range(3):
            self.assertTrue(limiter.allow("user:a", now=1000.0 + i))

    def test_blocks_beyond_limit_in_window(self):
        limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
        for i in range(3):
            limiter.allow("user:a", now=1000.0 + i)
        self.assertFalse(limiter.allow("user:a", now=1003.0))

    def test_allows_again_after_window_passes(self):
        limiter = SlidingWindowLimiter(limit=3, window_seconds=60)
        for i in range(3):
            limiter.allow("user:a", now=1000.0 + i)
        self.assertTrue(limiter.allow("user:a", now=1000.0 + 61))

    def test_keys_are_isolated(self):
        limiter = SlidingWindowLimiter(limit=1, window_seconds=60)
        self.assertTrue(limiter.allow("user:a", now=1000.0))
        self.assertTrue(limiter.allow("user:b", now=1000.0))
        self.assertFalse(limiter.allow("user:a", now=1001.0))


class CharQuotaTests(unittest.TestCase):
    def test_allows_within_daily_budget(self):
        quota = CharQuota(daily_chars=100)
        self.assertTrue(quota.try_consume("user:a", 60, day="2026-09-21"))
        self.assertTrue(quota.try_consume("user:a", 40, day="2026-09-21"))

    def test_blocks_over_daily_budget(self):
        quota = CharQuota(daily_chars=100)
        quota.try_consume("user:a", 100, day="2026-09-21")
        self.assertFalse(quota.try_consume("user:a", 1, day="2026-09-21"))

    def test_budget_resets_on_new_day(self):
        quota = CharQuota(daily_chars=100)
        quota.try_consume("user:a", 100, day="2026-09-21")
        self.assertTrue(quota.try_consume("user:a", 10, day="2026-09-22"))

    def test_partial_consume_when_budget_tight(self):
        """剩余额度足够时部分消耗被拒绝，保持结论完整外发或干脆不发。"""

        quota = CharQuota(daily_chars=100)
        quota.try_consume("user:a", 90, day="2026-09-21")
        self.assertFalse(quota.try_consume("user:a", 20, day="2026-09-21"))


if __name__ == "__main__":
    unittest.main()
