export type DataRow = Record<string, unknown>;

const TIME_KEYWORDS = ["date", "time", "year", "quarter", "month", "week", "day", "日期", "时间", "年", "季度", "月", "周", "日"];
const METRIC_KEYWORDS = ["sales", "amount", "gmv", "quantity", "count", "total", "sum", "revenue", "销售", "金额", "成交额", "销量", "数量", "订单", "总额", "均价", "利润"];

export function normalizeRows(data: unknown): DataRow[] {
  if (Array.isArray(data)) {
    return data.map((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as DataRow)
        : { 序号: index + 1, 值: item },
    );
  }
  if (data && typeof data === "object") return [data as DataRow];
  return [{ 值: data ?? "" }];
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, "").replace(/%$/, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreKey(key: string, keywords: string[]) {
  const normalized = key.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword)) ? 1 : 0;
}

export function buildDataset(data: unknown) {
  const rows = normalizeRows(data);
  const keys = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const numericKeys = keys
    .filter((key) => rows.length > 0 && rows.every((row) => toNumber(row[key]) !== null))
    .sort((a, b) => scoreKey(b, METRIC_KEYWORDS) - scoreKey(a, METRIC_KEYWORDS));
  const labelCandidates = keys.filter((key) => !numericKeys.includes(key));
  const labelKey = (labelCandidates.length ? labelCandidates : keys.filter((key) => key !== numericKeys[0]))
    .sort((a, b) => scoreKey(b, TIME_KEYWORDS) - scoreKey(a, TIME_KEYWORDS))[0];
  const chartRows: Array<Record<string, string | number>> = rows.slice(0, 20).map((row, index) => ({
    __label: String(labelKey ? row[labelKey] ?? `第 ${index + 1} 项` : `第 ${index + 1} 项`),
    ...Object.fromEntries(numericKeys.map((key) => [key, toNumber(row[key]) ?? 0])),
  }));
  const isTimeSeries = Boolean(labelKey && scoreKey(labelKey, TIME_KEYWORDS));
  return { rows, keys, numericKeys, labelKey, chartRows, isTimeSeries, truncated: rows.length > 20 };
}

export function formatMetric(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2, notation: Math.abs(value) >= 100000000 ? "compact" : "standard" }).format(value);
}
