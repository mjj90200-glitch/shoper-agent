/**
 * 首页空状态组件
 * 展示产品入口信息和可点击的示例问数问题
 */
import { BarChart3, LineChart, Search, Sparkles } from "lucide-react";

type EmptyStateProps = {
  examples: string[];
  onUseExample: (example: string) => void;
};

const highlights = [
  { label: "自然语言查数", detail: "理解指标、维度与业务口径", icon: Search },
  { label: "自动生成洞察", detail: "汇总、均值与极值自动解读", icon: LineChart },
  { label: "交互式可视化", detail: "柱状、趋势与占比视图切换", icon: BarChart3 },
];

export function EmptyState({ examples, onUseExample }: EmptyStateProps) {
  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-4 py-12">
      <div className="mb-9 max-w-3xl">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-semibold text-moss">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          AI数分助手
        </div>
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] text-ink sm:text-6xl sm:leading-[1.08]">
          让每一次提问，<span className="text-moss">直接抵达洞察</span>
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-500">描述你的业务问题，我会完成数据检索、SQL 执行与指标解读，并把关键结论转化为可交互图表。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {highlights.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-2xl border border-slate-200/80 bg-white/75 px-5 py-5 shadow-line backdrop-blur transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md">
              <div className="mb-5 grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-moss"><Icon className="h-5 w-5" aria-hidden="true" /></div>
              <div className="text-sm font-semibold text-ink">{item.label}</div>
              <div className="mt-1.5 text-xs leading-5 text-slate-500">{item.detail}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onUseExample(example)}
            className="group min-h-20 rounded-2xl border border-slate-200/80 bg-white/70 px-5 py-4 text-left text-[15px] leading-6 text-slate-700 shadow-line transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-white hover:text-moss hover:shadow-md focus:outline-none focus:ring-2 focus:ring-moss/30"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
