import type { QueryAudit } from "../types/agent";
import { authenticatedFetch } from "./http";

const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";
export type SessionItem = { session_id: string; title: string; created_at: string; updated_at: string };
const headers = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function fetchSessions(token: string): Promise<SessionItem[]> {
  const response = await authenticatedFetch(`${base}/api/sessions`, { headers: headers(token) });
  if (!response.ok) throw new Error("无法读取历史会话。");
  return response.json() as Promise<SessionItem[]>;
}

export async function fetchSession(id: string, token: string): Promise<QueryAudit[]> {
  const response = await authenticatedFetch(`${base}/api/sessions/${id}`, { headers: headers(token) });
  if (!response.ok) throw new Error("无法读取会话详情。");
  return response.json() as Promise<QueryAudit[]>;
}

export async function renameSession(id: string, title: string, token: string): Promise<SessionItem> {
  const response = await authenticatedFetch(`${base}/api/sessions/${id}`, {
    method: "PATCH",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) throw new Error("重命名会话失败。");
  return response.json() as Promise<SessionItem>;
}

export async function deleteSession(id: string, token: string) {
  const response = await authenticatedFetch(`${base}/api/sessions/${id}`, { method: "DELETE", headers: headers(token) });
  if (!response.ok) throw new Error("删除会话失败。");
}
