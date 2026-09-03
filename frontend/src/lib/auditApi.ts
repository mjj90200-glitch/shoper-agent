import type { QueryAudit } from "../types/agent";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function fetchMyAudits(accessToken: string): Promise<QueryAudit[]> {
  const response = await fetch(`${API_BASE_URL}/api/audits/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("无法读取审计记录。");
  }
  return response.json() as Promise<QueryAudit[]>;
}

export async function submitAuditFeedback(
  auditId: string,
  accessToken: string,
  score: "up" | "down",
  comment?: string,
): Promise<QueryAudit> {
  const response = await fetch(`${API_BASE_URL}/api/audits/${auditId}/feedback`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ score, comment: comment || null }),
  });
  if (!response.ok) {
    throw new Error("反馈保存失败，请重试。");
  }
  return response.json() as Promise<QueryAudit>;
}
