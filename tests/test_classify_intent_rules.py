"""意图分类规则层测试（纯函数、离线、零成本）。

口语化数据问法应在规则层直接判定为 data_query；数仓范围外主题必须
跳过关键词短路、交给具备域知识的 LLM 分类。
"""

import unittest

from app.agent.nodes.classify_intent import classify_by_rule


class ClassifyByRuleTests(unittest.TestCase):
    def test_colloquial_data_questions_are_data_query(self):
        for query in (
            "华东卖得怎么样？",
            "总共卖了多少钱？",
            "iPhone 15 Pro 2025 年卖了多少",
            "啥东西卖得最好？",
            "牌子卖得好坏排一下",
            "最近卖得怎么样？",
            "手机卖得如何？",
        ):
            with self.subTest(query=query):
                self.assertEqual(classify_by_rule(query), "data_query")

    def test_out_of_domain_topics_defer_to_llm(self):
        """范围外主题即使携带数据关键词也不允许规则层短路放行。"""

        for query in (
            "查一下各商品的库存还有多少",
            "统计每个商品的利润率",
            "各品类的采购成本是多少？",
            "统计各地区的退款率",
            "各地区的平均签收时长是多少？",
            "对比一下京东上同类商品的价格",
            "上个月广告投放花了多少钱？",
            "看下今年店铺的访客流量趋势",
        ):
            with self.subTest(query=query):
                self.assertIsNone(classify_by_rule(query))

    def test_existing_behaviours_unchanged(self):
        self.assertEqual(classify_by_rule("统计华东地区的销售额"), "data_query")
        self.assertEqual(classify_by_rule("你好"), "out_of_scope")
        self.assertEqual(classify_by_rule("你可以做什么"), "capability_help")
        self.assertEqual(classify_by_rule("今天天气如何"), "out_of_scope")
        # 不含任何已知关键词的问题交给 LLM 分类
        self.assertIsNone(classify_by_rule("帮我看看这个问题的答案"))


if __name__ == "__main__":
    unittest.main()
