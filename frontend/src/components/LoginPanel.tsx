import { KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { login } from "../lib/authApi";
import type { CurrentUser } from "../types/agent";

type LoginPanelProps = {
  onLoggedIn: (auth: { accessToken: string; user: CurrentUser }) => void;
};

const demoAccounts = [
  ["admin", "admin123", "管理员：全部数据"],
  ["east_manager", "east123", "区域经理：仅华东，姓名脱敏"],
  ["analyst", "analyst123", "分析员：全地区汇总，姓名脱敏"],
] as const;

export function LoginPanel({ onLoggedIn }: LoginPanelProps) {
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
    <main className="grid min-h-dvh place-items-center bg-parchment px-4 text-ink">
      <section className="w-full max-w-md border border-ink/15 bg-[#fffaf1] p-6 shadow-line">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center bg-moss text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-semibold">电商问数 · 演示登录</h1>
            <p className="text-xs text-ink/50">本地账号与数据权限演示</p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm">
            用户名
            <input className="border border-ink/20 bg-white px-3 py-2 outline-none focus:border-moss" value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">
            密码
            <input type="password" className="border border-ink/20 bg-white px-3 py-2 outline-none focus:border-moss" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <p className="text-sm text-tomato">{error}</p>}
          <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 bg-ink px-4 py-2.5 text-sm font-semibold text-parchment disabled:opacity-50">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            {loading ? "登录中..." : "登录"}
          </button>
        </form>

        <div className="mt-6 border-t border-ink/10 pt-4 text-xs text-ink/60">
          <div className="mb-2 font-semibold">演示账号</div>
          <div className="space-y-2">
            {demoAccounts.map(([name, demoPassword, scope]) => (
              <button key={name} type="button" className="block text-left hover:text-moss" onClick={() => { setUsername(name); setPassword(demoPassword); }}>
                <code>{name} / {demoPassword}</code> · {scope}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
