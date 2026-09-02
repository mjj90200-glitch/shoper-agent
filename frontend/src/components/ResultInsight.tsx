import type { ResultAnalysis } from "../types/agent";

type ResultInsightProps = {
  analysis: ResultAnalysis;
};

export function ResultInsight({ analysis }: ResultInsightProps) {
  const chart = analysis.chart;
  const maxValue = chart ? Math.max(...chart.data.map((point) => Math.abs(point.value)), 1) : 1;

  return (
    <section className="mt-4 border border-moss/20 bg-moss/[0.045] p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-moss">结果解读</div>
      <p className="text-sm leading-6 text-ink/80">{analysis.summary}</p>

      {chart && (
        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-ink/55">
            <span>{chart.type === "line" ? "趋势图" : "对比图"}</span>
            <span>{chart.value_key}</span>
          </div>
          <div className={chart.type === "line" ? "flex h-36 items-end gap-2 border-b border-ink/15 px-1" : "space-y-2"}>
            {chart.data.map((point) => {
              const ratio = `${Math.max((Math.abs(point.value) / maxValue) * 100, 2)}%`;
              if (chart.type === "line") {
                return (
                  <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                    <span className="text-[10px] text-ink/60">{point.value.toLocaleString("zh-CN")}</span>
                    <div className="w-full min-w-2 bg-moss/75" style={{ height: ratio }} title={`${point.label}: ${point.value}`} />
                    <span className="max-w-full truncate text-[10px] text-ink/55">{point.label}</span>
                  </div>
                );
              }
              return (
                <div key={point.label} className="grid grid-cols-[minmax(64px,0.45fr)_1fr_auto] items-center gap-2 text-xs">
                  <span className="truncate text-ink/65">{point.label}</span>
                  <div className="h-2 overflow-hidden bg-ink/8">
                    <div className="h-full bg-moss/75" style={{ width: ratio }} />
                  </div>
                  <span className="font-mono text-ink/70">{point.value.toLocaleString("zh-CN")}</span>
                </div>
              );
            })}
          </div>
          {chart.truncated && <div className="mt-2 text-xs text-ink/45">仅展示前 12 行结果。</div>}
        </div>
      )}
    </section>
  );
}
