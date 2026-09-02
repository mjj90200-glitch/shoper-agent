/**
 * 查询结果表格组件
 * 将后端返回的结构化数据归一化为可滚动表格
 */
import { Database, Download, FileJson } from "lucide-react";

function normalizeRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) {
    return data.map((item, index) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? (item as Record<string, unknown>)
        : { 序号: index + 1, 值: item },
    );
  }

  if (data && typeof data === "object") {
    return [data as Record<string, unknown>];
  }

  return [{ 值: data ?? "" }];
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toCsvCell(value: unknown) {
  return `"${formatCell(value).replace(/"/g, '""')}"`;
}

export function ResultTable({ data }: { data: unknown }) {
  const rows = normalizeRows(data);
  const columns = Array.from(
    rows.reduce((keys, row) => {
      Object.keys(row).forEach((key) => keys.add(key));
      return keys;
    }, new Set<string>()),
  );

  if (columns.length === 0) {
    return null;
  }

  const downloadCsv = () => {
    const content = [
      columns.map(toCsvCell).join(","),
      ...rows.map((row) => columns.map((column) => toCsvCell(row[column])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${content}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "shopkeeper-query-result.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-4 overflow-hidden border border-ink/10 bg-white/70 shadow-line">
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Database className="h-4 w-4 text-moss" aria-hidden="true" />
          查询结果
        </div>
        <div className="flex items-center gap-3 text-xs text-ink/55">
          <span className="inline-flex items-center gap-2">
            <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
            {rows.length} 行
          </span>
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-1 text-ink/60 transition hover:text-moss"
            title="导出 CSV"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            CSV
          </button>
        </div>
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[#efe6d8]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="border-b border-ink/10 px-4 py-3 font-semibold text-ink/70"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-white/45 even:bg-white/20">
                {columns.map((column) => (
                  <td key={column} className="border-b border-ink/5 px-4 py-3 text-ink/80">
                    {formatCell(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
