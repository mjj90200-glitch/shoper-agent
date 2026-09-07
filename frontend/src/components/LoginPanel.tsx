import { BarChart3, KeyRound, Sparkles } from "lucide-react";
import { useState } from "react";
import { login } from "../lib/authApi";
import type { CurrentUser } from "../types/agent";

type LoginPanelProps = {
  onLoggedIn: (auth: { accessToken: string; user: CurrentUser }) => void;
  notice?: string | null;
};

const demoAccounts = [
  ["admin", "admin123", "管理员：全部数据"],
  ["east_manager", "east123", "区域经理：仅华东，姓名脱敏"],
  ["analyst", "analyst123", "分析员：全地区汇总，姓名脱敏"],
] as const;

export function LoginPanel({ onLoggedIn, notice }: LoginPanelProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await login(username, password);
      onLoggedIn({ accessToken: result.access_token, user: result.user });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败，请重试。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-soot px-4 text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(22,136,248,0.25),transparent_30%),radial-gradient(circle_at_85%_85%,rgba(6,182,212,0.16),transparent_30%)]" />
      <section className="relative w-full max-w-md rounded-3xl border border-white/15 bg-white/95 p-7 shadow-[0_30px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-moss to-brass text-white shadow-lg shadow-moss/20">
            <BarChart3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-semibold">AI数分助手</h1>
            <p className="text-xs text-slate-500">让数据直接回答业务问题</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          {notice && <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 text-sm leading-5 text-slate-700">{notice}</div>}
          <label className="grid gap-1.5 text-sm">
            用户名
            <input className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-moss focus:bg-white focus:ring-2 focus:ring-moss/10" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            密码
            <input type="password" className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 outline-none transition focus:border-moss focus:bg-white focus:ring-2 focus:ring-moss/10" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p className="text-sm text-tomato">{error}</p>}
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-moss px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-moss/20 transition hover:bg-blue-500 disabled:opacity-50">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-xs text-slate-500">
          <div className="mb-2 flex items-center gap-2 font-semibold text-slate-700"><Sparkles className="h-3.5 w-3.5 text-moss" />演示账号</div>
          <div className="space-y-2">
            {demoAccounts.map(([name, demoPassword, scope]) => (
              <button key={name} type="button" className="block text-left transition hover:text-moss" onClick={() => { setUsername(name); setPassword(demoPassword); }}>
                <code>{name} / {demoPassword}</code> · {scope}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
