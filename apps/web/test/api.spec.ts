import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, API_BASE } from "../lib/api";

/** Captures the rejection of a call without letting it fail the test. */
async function capture(path: string, init?: RequestInit): Promise<unknown> {
  try {
    await apiFetch(path, init);
    return null;
  } catch (error) {
    return error;
  }
}

function stubFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns parsed JSON on 200", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(apiFetch<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });
  });

  it("throws ApiError(401) on 401", async () => {
    stubFetch(async () => new Response("unauthenticated", { status: 401 }));

    const error = await capture("/projects");
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe("unauthenticated");
  });

  it("throws ApiError(status) on 4xx/5xx with the body as message", async () => {
    stubFetch(async () => new Response("invalid branch name", { status: 422 }));

    const clientError = await capture("/projects/x/run", { method: "POST", body: "{}" });
    expect(clientError).toBeInstanceOf(ApiError);
    expect((clientError as ApiError).status).toBe(422);
    expect((clientError as ApiError).message).toBe("invalid branch name");
  });

  it("falls back to statusText when the error body is empty", async () => {
    stubFetch(async () => new Response(null, { status: 500, statusText: "Server Error" }));

    const serverError = await capture("/runs/1");
    expect(serverError).toBeInstanceOf(ApiError);
    expect((serverError as ApiError).status).toBe(500);
    expect((serverError as ApiError).message).toBe("Server Error");
  });

  it("passes credentials: 'include' on every call so the session cookie rides along", async () => {
    const spy = stubFetch(async () => new Response("{}", { status: 200 }));

    await apiFetch("/projects");
    await apiFetch("/projects/1/run", { method: "POST", body: "{}" });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]?.[0]).toBe(`${API_BASE}/projects`);
    for (const [, init] of spy.mock.calls) {
      expect(init?.credentials).toBe("include");
    }
  });
});
