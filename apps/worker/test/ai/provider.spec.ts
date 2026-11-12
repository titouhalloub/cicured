import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvSchema } from "../../src/env";
import { createLlmProvider } from "../../src/ai/provider";

const VALID_ENV = {
  DATABASE_URL: "postgres://sft:sft@localhost:5432/sft_dev",
  SFT_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: "test-private-key",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter provider", () => {
  it("sends system/user messages and maps text and token usage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"patchDiff":"@@","explanation":"ok"}' } }],
          usage: { prompt_tokens: 123, completion_tokens: 45 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "test-openrouter-key",
      LLM_MODEL: "openai/gpt-4.1-mini",
    });
    const provider = createLlmProvider(env);
    expect(provider?.name).toBe("openrouter");
    expect(provider?.model).toBe("openai/gpt-4.1-mini");

    const result = await provider!.complete({
      system: "system prompt",
      user: "user prompt",
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Expected OpenRouter fetch to be called");
    const [url, request] = call;
    if (!request) throw new Error("Expected OpenRouter request options");
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((request.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-openrouter-key",
    );
    const body = JSON.parse(String(request.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("openai/gpt-4.1-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "user prompt" },
    ]);
    expect(result).toEqual({
      text: '{"patchDiff":"@@","explanation":"ok"}',
      promptTokens: 123,
      completionTokens: 45,
    });
  });

  it("returns null when the selected provider key is missing", () => {
    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "openrouter",
      LLM_MODEL: "openai/gpt-4.1-mini",
    });
    expect(createLlmProvider(env)).toBeNull();
  });

  it("surfaces non-success HTTP responses without exposing the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("provider unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "must-not-appear-in-error",
      LLM_MODEL: "openai/gpt-4.1-mini",
    });
    const provider = createLlmProvider(env);
    await expect(
      provider!.complete({
        system: "system",
        user: "user",
        maxOutputTokens: 100,
        temperature: 0,
      }),
    ).rejects.toThrow("HTTP 503: provider unavailable");
  });
});
