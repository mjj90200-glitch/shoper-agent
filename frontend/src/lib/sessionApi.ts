import type { QueryAudit } from "../types/agent";

const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
export type SessionItem = { session_id: string; title: string; created_at: string; updated_at: string };
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });
export const fetchSessions = async (token: string) => (await fetch(`${base}/api/sessions`, { headers: headers(token) })).json() as Promise<SessionItem[]>;
export const fetchSession = async (id: string, token: string) => (await fetch(`${base}/api/sessions/${id}`, { headers: headers(token) })).json() as Promise<QueryAudit[]>;
export const deleteSession = async (id: string, token: string) => { await fetch(`${base}/api/sessions/${id}`, { method: "DELETE", headers: headers(token) }); };
