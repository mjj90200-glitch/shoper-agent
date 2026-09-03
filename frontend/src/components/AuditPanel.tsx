import { Clock3, FileSearch, X } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchMyAudits, fetchQualitySummary } from "../lib/auditApi";
import type { QualitySummary, QueryAudit } from "../types/agent";

type AuditPanelProps = {
  accessToken: string;
  isAdmin: boolean;
  onClose: () => void;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function AuditPanel({ accessToken, isAdmin, onClose }: AuditPanelProps) {
  const [records, setRecords] = useState<QueryAudit[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<QualitySummary | null>(null);

  useEffect(() => {
    void fetchMyAudits(accessToken)
      .then(setRecords)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "加载失败。"))
      .finally(() => setLoading(false));
  }, [accessToken]);

  useEffect(() => {
    if (isAdmin) void fetchQualitySummary(accessToken).then(setSummary).catch(() => undefined);
  }, [accessToken, isAdmin]);

  return (
    <div className="fixed inset-0 z-20 bg-ink/25 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="查询审计记录">
      <section className="ml-auto flex h-full w-full max-w-xl flex-col bg-[#fffaf1] shadow-line">
        <header className="flex items-center justify-between border-b border-ink/10 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold"><FileSearch className="h-4 w-4 text-moss" />查询审计</h2>
            <p className="mt-1 text-xs text-ink/50">仅显示当前登录用户、本次服务进程内的最近记录</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center text-ink/55 hover:bg-ink/5" aria-label="关闭审计记录">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {summary && <section className="grid grid-cols-2 gap-px bg-ink/10 text-center text-xs"><div className="bg-[#fffaf1] p-3">总问数<br /><b>{summary.total_queries}</b></div><div className="bg-[#fffaf1] p-3">成功率<br /><b>{Math.round(summary.success_rate * 100)}%</b></div><div className="bg-[#fffaf1] p-3">平均耗时<br /><b>{summary.average_duration_ms}ms</b></div><div className="bg-[#fffaf1] p-3">好评率<br /><b>{summary.feedback_count ? `${Math.round(summary.helpful_rate * 100)}%` : "—"}</b></div></section>}
          {loading && <p className="text-sm text-ink/55">正在读取记录…</p>}
          {error && <p className="text-sm text-tomato">{error}</p>}
          {!loading && !error && records.length === 0 && <p className="text-sm text-ink/55">当前还没有查询记录。</p>}
          {records.map((record) => (
            <article key={record.id} className="border border-ink/12 bg-white/60 p-3 text-sm">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-ink/50">
                <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{formatTime(record.started_at)}</span>
                <span className={record.status === "succeeded" ? "text-moss" : "text-tomato"}>
                  {record.status === "succeeded" ? "成功" : "失败"}{record.duration_ms !== null ? ` · ${record.duration_ms}ms` : ""}
                </span>
              </div>
              <p className="font-medium leading-5 text-ink">{record.query}</p>
              {record.resolved_query && record.resolved_query !== record.query && <p className="mt-1 text-xs leading-5 text-ink/60">理解为：{record.resolved_query}</p>}
              {record.result_row_count !== null && <p className="mt-2 text-xs text-ink/60">返回 {record.result_row_count} 行</p>}
              {record.error && <p className="mt-2 text-xs text-tomato">{record.error}</p>}
              {record.feedback_score && <p className="mt-2 text-xs text-ink/60">用户反馈：{record.feedback_score === "up" ? "有帮助" : "需改进"}{record.feedback_comment ? ` · ${record.feedback_comment}` : ""}</p>}
              {record.sql && <details className="mt-2 text-xs text-ink/60"><summary className="cursor-pointer">最终 SQL</summary><pre className="mt-2 overflow-x-auto whitespace-pre-wrap bg-ink/5 p-2 text-[11px]">{record.sql}</pre></details>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
