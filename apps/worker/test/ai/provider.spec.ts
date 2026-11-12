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

describe("LLM provider configuration", () => {
  it("accepts OpenRouter and constructs the selected provider", () => {
    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "test-openrouter-key",
      LLM_MODEL: "anthropic/claude-sonnet-4.5",
    });

    const provider = createLlmProvider(env);
    expect(provider?.name).toBe("openrouter");
    expect(provider?.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("accepts Anthropic and constructs the selected provider", () => {
    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: "test-anthropic-key",
      LLM_MODEL: "claude-sonnet-4-5",
    });

    const provider = createLlmProvider(env);
    expect(provider?.name).toBe("anthropic");
    expect(provider?.model).toBe("claude-sonnet-4-5");
  });

  it("disables suggestions when the selected provider key is missing", () => {
    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "openrouter",
      LLM_MODEL: "anthropic/claude-sonnet-4.5",
    });

    expect(createLlmProvider(env)).toBeNull();
  });

  it("sends OpenRouter chat messages and maps response usage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"summary":"ok"}' } }],
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
      LLM_MODEL: "anthropic/claude-sonnet-4.5",
    });
    const provider = createLlmProvider(env);
    expect(provider).not.toBeNull();

    const result = await provider!.complete({
      system: "system prompt",
      user: "user prompt",
      maxOutputTokens: 500,
      temperature: 0.1,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((request!.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-openrouter-key",
    );
    expect(JSON.parse(String(request!.body))).toMatchObject({
      model: "anthropic/claude-sonnet-4.5",
      messages: [
        { role: "system", content: "system prompt" },
        { role: "user", content: "user prompt" },
      ],
    });
    expect(result).toEqual({
      text: '{"summary":"ok"}',
      promptTokens: 123,
      completionTokens: 45,
    });
  });

  it("reports provider HTTP failures without including the API key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("provider unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const env = EnvSchema.parse({
      ...VALID_ENV,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "must-not-appear-in-errors",
      LLM_MODEL: "anthropic/claude-sonnet-4.5",
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
