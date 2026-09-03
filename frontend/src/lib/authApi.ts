import type { CurrentUser } from "../types/agent";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  user: CurrentUser;
};

export async function login(username: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error("用户名或密码错误。");
  }
  return response.json() as Promise<LoginResponse>;
}
