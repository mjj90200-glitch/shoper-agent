import { BarChart3, ChartPie, LineChart as LineChartIcon, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildDataset, formatMetric } from "../lib/dataAnalysis";
import { cn } from "../lib/format";
import type { ResultAnalysis } from "../types/agent";

type ChartView = "bar" | "line" | "pie";
const COLORS = ["#1688f8", "#06b6d4", "#6366f1", "#8b5cf6", "#14b8a6", "#f59e0b", "#ec4899", "#64748b"];

export function ResultInsight({ analysis, data }: { analysis: ResultAnalysis; data: unknown }) {
  const dataset = useMemo(() => buildDataset(data), [data]);
  const initialMetric = analysis.chart?.value_key && dataset.numericKeys.includes(analysis.chart.value_key)
    ? analysis.chart.value_key
    : dataset.numericKeys[0] ?? "";
  const [metric, setMetric] = useState(initialMetric);
  const [view, setView] = useState<ChartView>(analysis.chart?.type ?? (dataset.isTimeSeries ? "line" : "bar"));
  const values = dataset.chartRows.map((row) => Number(row[metric] ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  const maxIndex = values.length ? values.indexOf(Math.max(...values)) : -1;
  const hasChart = Boolean(metric && dataset.chartRows.length);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50/80 to-white shadow-[0_12px_35px_rgba(22,136,248,0.08)]">
      <div className="border-b border-blue-100 px-4 py-4 sm:px-5">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-moss">
          <TrendingUp className="h-4 w-4" aria-hidden="true" /> 数据洞察
        </div>
        <p className="text-sm leading-6 text-slate-700">{analysis.summary}</p>
      </div>

      {hasChart && (
        <>
          <div className="grid grid-cols-2 border-b border-blue-100 bg-white/70 sm:grid-cols-4">
            {[
              ["合计", formatMetric(total)],
              ["平均值", formatMetric(average)],
              ["最高项", maxIndex >= 0 ? dataset.chartRows[maxIndex].__label : "—"],
              ["数据点", `${dataset.rows.length} 条`],
            ].map(([label, value]) => (
              <div key={label} className="border-r border-blue-100 px-4 py-3.5 last:border-r-0">
                <div className="text-[11px] font-medium text-slate-400">{label}</div>
                <div className="mt-1 truncate text-lg font-semibold tracking-tight text-slate-900" title={String(value)}>{value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-line">
              {([
                ["bar", "柱状", BarChart3],
                ["line", "趋势", LineChartIcon],
                ["pie", "占比", ChartPie],
              ] as const).map(([type, label, Icon]) => (
                <button key={type} type="button" onClick={() => setView(type)} className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs transition",
                  view === type ? "bg-moss font-semibold text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                )} aria-pressed={view === type}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
                </button>
              ))}
            </div>
            {dataset.numericKeys.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                分析指标
                <select value={metric} onChange={(event) => setMetric(event.target.value)} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 outline-none focus:border-moss">
                  {dataset.numericKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="h-[310px] px-2 pb-4 sm:px-4" aria-label={`${metric}可视化图表`}>
            <ResponsiveContainer width="100%" height="100%">
              {view === "line" ? (
                <LineChart data={dataset.chartRows} margin={{ top: 16, right: 18, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="#94a3b8" strokeOpacity={0.18} vertical={false} />
                  <XAxis dataKey="__label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={55} tickFormatter={formatMetric} />
                  <Tooltip formatter={(value) => [formatMetric(Number(value)), metric]} contentStyle={{ border: "1px solid #dbeafe", background: "#ffffff", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.12)" }} />
                  <Line type="monotone" dataKey={metric} stroke="#1688f8" strokeWidth={2.5} dot={{ r: 3, fill: "#ffffff", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                </LineChart>
              ) : view === "pie" ? (
                <PieChart>
                  <Pie data={dataset.chartRows} dataKey={metric} nameKey="__label" cx="50%" cy="50%" innerRadius="42%" outerRadius="72%" paddingAngle={2}>
                    {dataset.chartRows.map((row, index) => <Cell key={`${row.__label}-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => [formatMetric(Number(value)), metric]} contentStyle={{ border: "1px solid #dbeafe", background: "#ffffff", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.12)" }} />
                </PieChart>
              ) : (
                <BarChart data={dataset.chartRows} margin={{ top: 16, right: 18, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="#94a3b8" strokeOpacity={0.18} vertical={false} />
                  <XAxis dataKey="__label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} width={55} tickFormatter={formatMetric} />
                  <Tooltip formatter={(value) => [formatMetric(Number(value)), metric]} cursor={{ fill: "rgba(22,136,248,.06)" }} contentStyle={{ border: "1px solid #dbeafe", background: "#ffffff", borderRadius: 12, boxShadow: "0 12px 30px rgba(15,23,42,.12)" }} />
                  <Bar dataKey={metric} fill="#1688f8" radius={[6, 6, 0, 0]} maxBarSize={54} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          {(dataset.truncated || analysis.chart?.truncated) && <div className="border-t border-blue-100 px-5 py-2 text-xs text-slate-400">图表展示前 20 个数据点，完整结果请查看下方明细。</div>}
        </>
      )}
    </section>
  );
}
