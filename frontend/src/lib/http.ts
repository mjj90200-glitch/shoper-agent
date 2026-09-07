export const AUTH_EXPIRED_EVENT = "shopkeeper-agent:auth-expired";

export class AuthenticationExpiredError extends Error {
  constructor() {
    super("登录状态已过期，请重新登录。");
    this.name = "AuthenticationExpiredError";
  }
}

/** 统一处理受保护接口，避免把 401 当成普通网络错误展示。 */
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, init);
  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    throw new AuthenticationExpiredError();
  }
  return response;
}
