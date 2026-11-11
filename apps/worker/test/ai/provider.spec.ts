import { describe, expect, it, vi } from "vitest";
import { EnvSchema } from "../../src/env";
import { createLlmProvider } from "../../src/ai/provider";

const BASE = {
  DATABASE_URL: "postgres://localhost/test",
  SFT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: "private-key",
  S3_ACCESS_KEY_ID: "access",
  S3_SECRET_ACCESS_KEY: "secret",
};

describe("createLlmProvider", () => {
  it("selects OpenRouter and its own credential", () => {
    const env = EnvSchema.parse({
      ...BASE,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "router-key",
      LLM_MODEL: "anthropic/claude-sonnet-4.5",
    });
    const provider = createLlmProvider(env);
    expect(provider?.name).toBe("openrouter");
    expect(provider?.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it("does not require the Anthropic key when OpenRouter is selected", () => {
    const env = EnvSchema.parse({
      ...BASE,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "router-key",
    });
    expect(createLlmProvider(env)).not.toBeNull();
  });

  it("returns null when the selected provider key is missing", () => {
    const env = EnvSchema.parse({ ...BASE, LLM_PROVIDER: "openrouter" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(createLlmProvider(env)).toBeNull();
    expect(error).toHaveBeenCalledWith("[sft-worker] OPENROUTER_API_KEY is not set");
    error.mockRestore();
  });

  it("preserves Anthropic selection", () => {
    const env = EnvSchema.parse({ ...BASE, ANTHROPIC_API_KEY: "anthropic-key" });
    expect(createLlmProvider(env)?.name).toBe("anthropic");
  });
});
