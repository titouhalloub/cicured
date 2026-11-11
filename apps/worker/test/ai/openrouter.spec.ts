import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterProvider } from "../../src/ai/providers/openrouter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter provider", () => {
  it("sends chat-completions requests and maps text and token usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Suggested fix" } }],
          usage: { prompt_tokens: 123, completion_tokens: 45 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createOpenRouterProvider("test-key", "anthropic/claude-sonnet-4.5");
    const result = await provider.complete({
      system: "You review code.",
      user: "Review this diff.",
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    expect(provider.name).toBe("openrouter");
    expect(provider.model).toBe("anthropic/claude-sonnet-4.5");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "anthropic/claude-sonnet-4.5",
      messages: [
        { role: "system", content: "You review code." },
        { role: "user", content: "Review this diff." },
      ],
      max_tokens: 500,
      temperature: 0.1,
    });
    expect(result).toEqual({
      text: "Suggested fix",
      promptTokens: 123,
      completionTokens: 45,
    });
  });

  it("reports API errors without exposing the API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("invalid request", { status: 400 })),
    );
    const provider = createOpenRouterProvider("secret-key", "model/name");
    await expect(
      provider.complete({ system: "", user: "", maxOutputTokens: 10, temperature: 0 }),
    ).rejects.toThrow("HTTP 400: invalid request");
  });
});
