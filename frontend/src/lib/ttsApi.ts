import { authenticatedFetch } from "./http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function synthesizeConclusion(
  text: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/tts/synthesize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ text }),
    signal,
  });

  if (!response.ok) {
    let message = `语音生成失败：HTTP ${response.status}`;
    try {
      const payload = await response.json() as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // 上游错误不是 JSON 时保留状态码信息。
    }
    throw new Error(message);
  }
  return response.blob();
}
