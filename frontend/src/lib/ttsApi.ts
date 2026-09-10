import { authenticatedFetch } from "./http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

export async function synthesizeSpeech(
  text: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const response = await authenticatedFetch(`${API_BASE_URL}/api/tts/synthesize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(body?.detail || `语音合成失败：HTTP ${response.status}`);
  }
  return response.blob();
}
