import { History, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteSession, fetchSession, fetchSessions, type SessionItem } from "../lib/sessionApi";
import type { QueryAudit } from "../types/agent";

export function SessionPanel({ accessToken, onClose, onSelect }: { accessToken: string; onClose: () => void; onSelect: (item: SessionItem, records: QueryAudit[]) => void }) {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  useEffect(() => { void fetchSessions(accessToken).then(setSessions); }, [accessToken]);
  return <div className="fixed inset-0 z-20 bg-ink/25 p-4 sm:p-8"><section className="ml-auto h-full w-full max-w-md bg-[#fffaf1] p-5 shadow-line"><header className="mb-4 flex justify-between"><h2 className="flex gap-2 font-semibold"><History className="h-4 w-4" />历史会话</h2><button onClick={onClose}><X className="h-4 w-4" /></button></header><div className="space-y-2">{sessions.map(item => <div key={item.session_id} className="flex border border-ink/10"><button className="min-w-0 flex-1 p-3 text-left text-sm" onClick={() => void fetchSession(item.session_id, accessToken).then(records => onSelect(item, records))}>{item.title}</button><button className="p-3 text-tomato" onClick={() => void deleteSession(item.session_id, accessToken).then(() => setSessions(sessions.filter(s => s.session_id !== item.session_id)))}><Trash2 className="h-4 w-4" /></button></div>)}</div></section></div>;
}
