// All requests go to the Next.js server, which proxies /api/* to the API.
// This keeps cookies same-origin and eliminates CORS.
import type { UsageSummary } from "@sft/schemas";

const API_URL = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Typed fetch wrapper for the API. The session cookie is httpOnly; every call
 * sends it with `credentials: "include"` and JS never touches its value.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError(401, "unauthenticated");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}

/**
 * GET /usage/summary — LLM spend totals behind the dashboard's AI Spend card.
 * Rides the shared wrapper: same-origin proxy, session cookie, and ApiError
 * (status + body) on any non-2xx.
 */
export function getUsageSummary(): Promise<UsageSummary> {
  return apiFetch<UsageSummary>("/usage/summary");
}

export const API_BASE = API_URL;
