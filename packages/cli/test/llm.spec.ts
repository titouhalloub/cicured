import type { Neighborhood } from "@sft/parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMessages, suggestFix, type SuggestInput, type LlmProvider } from "../src/llm";
import { AnthropicProvider } from "../src/llm/anthropic";
import { OpenAiCompatProvider } from "../src/llm/openai-compat";
import { detectProvider } from "../src/llm/detect";
import { lookupPricing, computeCostUsd, DEFAULT_PRICING } from "../src/llm/pricing";

const NEIGHBORHOOD: Neighborhood = {
  file: {
    path: "src/auth.ts",
    imports: [],
    importedBy: [],
    functions: [],
    tests: ["test/auth.test.ts"],
  },
  function: {
    name: "login",
    file: "src/auth.ts",
    line: 40,
    callsTo: [],
    calledBy: ["handleLogin"],
    referencedIn: [],
  },
  callers: [
    {
      name: "handleLogin",
      file: "src/routes.ts",
      line: 10,
      callsTo: [],
      calledBy: [],
      referencedIn: [],
    },
  ],
  callees: [],
  tests: ["test/auth.test.ts"],
};

const INPUT: SuggestInput = {
  ruleId: "TS2339",
  file: "src/auth.ts",
  line: 42,
  message: "Property 'x' does not exist",
  snippet: "const x = 1;",
  neighborhood: NEIGHBORHOOD,
};

const MOCK_PROVIDER: LlmProvider = {
  providerId: "anthropic",
  model: "claude-sonnet-4-5",
  pricing: { inputPerM: 3.00, outputPerM: 15.00 },
  complete: vi.fn(),
};

function stubAnthropicFetch(text: string): void {
  const payload = {
    content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
  const response = {
    ok: true,
    status: 200,
    json: async (): Promise<unknown> => payload,
    text: async (): Promise<string> => JSON.stringify(payload),
  };
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

function stubOpenAiFetch(text: string): void {
  const payload = {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
  const response = {
    ok: true,
    status: 200,
    json: async (): Promise<unknown> => payload,
    text: async (): Promise<string> => JSON.stringify(payload),
  };
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("suggestFix filesTouched validation", () => {
  it("throws when the model returns filesTouched outside the neighborhood", async () => {
    vi.mocked(MOCK_PROVIDER.complete).mockResolvedValue({
      text: JSON.stringify({
        patchDiff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42 +42 @@\n-old\n+new",
        explanation: "Fix applied.",
        confidence: 0.9,
        filesTouched: ["src/unrelated.ts"],
      }),
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, source: "reported" },
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      durationMs: 100,
    });
    await expect(suggestFix(MOCK_PROVIDER, INPUT)).rejects.toThrow(
      "filesTouched outside neighborhood: src/unrelated.ts",
    );
  });

  it("accepts filesTouched that matches the finding's file", async () => {
    vi.mocked(MOCK_PROVIDER.complete).mockResolvedValue({
      text: JSON.stringify({
        patchDiff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42 +42 @@\n-old\n+new",
        explanation: "Fix applied.",
        confidence: 0.9,
        filesTouched: ["src/auth.ts"],
      }),
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, source: "reported" },
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      durationMs: 100,
    });
    await expect(suggestFix(MOCK_PROVIDER, INPUT)).resolves.toMatchObject({
      filesTouched: ["src/auth.ts"],
    });
  });

  it("accepts filesTouched that matches a caller's file", async () => {
    vi.mocked(MOCK_PROVIDER.complete).mockResolvedValue({
      text: JSON.stringify({
        patchDiff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42 +42 @@\n-old\n+new",
        explanation: "Fix applied.",
        confidence: 0.9,
        filesTouched: ["src/routes.ts"],
      }),
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, source: "reported" },
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      durationMs: 100,
    });
    await expect(suggestFix(MOCK_PROVIDER, INPUT)).resolves.toMatchObject({
      patchDiff: expect.stringContaining("@@"),
    });
  });

  it("accepts any filesTouched when neighborhood is null", async () => {
    vi.mocked(MOCK_PROVIDER.complete).mockResolvedValue({
      text: JSON.stringify({
        patchDiff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42 +42 @@\n-old\n+new",
        explanation: "Fix applied.",
        confidence: 0.9,
        filesTouched: ["anywhere/at/all.ts"],
      }),
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheCreationTokens: 0, source: "reported" },
      model: "claude-sonnet-4-5",
      provider: "anthropic",
      durationMs: 100,
    });
    await expect(
      suggestFix(MOCK_PROVIDER, { ...INPUT, neighborhood: null }),
    ).resolves.toMatchObject({ filesTouched: ["anywhere/at/all.ts"] });
  });
});

describe("buildMessages", () => {
  it("includes <codegraph_neighborhood> when a neighborhood is provided", () => {
    const { user } = buildMessages(INPUT, "suggest");
    expect(user).toContain("<codegraph_neighborhood>");
    expect(user).toContain("File: src/auth.ts");
    expect(user).toContain("Called by:");
    expect(user).toContain("Tests that import this file:");
  });

  it("omits <codegraph_neighborhood> when neighborhood is null", () => {
    const { user } = buildMessages({ ...INPUT, neighborhood: null }, "suggest");
    expect(user).not.toContain("<codegraph_neighborhood>");
  });

  it("uses explain system prompt for explain mode", () => {
    const { system } = buildMessages(INPUT, "explain");
    expect(system).toContain("diagnostic assistant");
    expect(system).not.toContain("code-fix assistant");
  });
});

describe("AnthropicProvider", () => {
  it("parses content[0].text and usage from Anthropic response", async () => {
    stubAnthropicFetch("Hello from Claude");
    const provider = new AnthropicProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
      pricing: { inputPerM: 3.00, outputPerM: 15.00 },
    });
    const response = await provider.complete({
      system: "You are a helpful assistant.",
      user: "Say hello.",
      maxTokens: 100,
      temperature: 0.2,
    });
    expect(response.text).toBe("Hello from Claude");
    expect(response.usage.source).toBe("reported");
    expect(response.usage.inputTokens).toBe(100);
    expect(response.usage.outputTokens).toBe(50);
    expect(response.provider).toBe("anthropic");
    expect(response.model).toBe("claude-sonnet-4-5");
  });
});

describe("OpenAiCompatProvider", () => {
  it("parses choices[0].message.content and usage from OpenAI response", async () => {
    stubOpenAiFetch("Hello from GPT");
    const provider = new OpenAiCompatProvider({
      provider: "openai",
      model: "gpt-5",
      apiKey: "test-key",
      pricing: { inputPerM: 2.50, outputPerM: 10.00 },
    });
    const response = await provider.complete({
      system: "You are a helpful assistant.",
      user: "Say hello.",
      maxTokens: 100,
      temperature: 0.2,
    });
    expect(response.text).toBe("Hello from GPT");
    expect(response.usage.source).toBe("reported");
    expect(response.provider).toBe("openai");
    expect(response.endpoint).toContain("/chat/completions");
  });

  it("falls back to estimated usage when response has no usage field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Hello" } }] }),
      text: async () => JSON.stringify({ choices: [{ message: { content: "Hello" } }] }),
    })));
    const provider = new OpenAiCompatProvider({
      provider: "openai",
      model: "gpt-5",
      apiKey: "test-key",
      pricing: { inputPerM: 2.50, outputPerM: 10.00 },
    });
    const response = await provider.complete({
      system: "You are a helpful assistant.",
      user: "Say hello.",
      maxTokens: 100,
      temperature: 0.2,
    });
    expect(response.usage.source).toBe("estimated");
  });
});

describe("detectProvider", () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    delete process.env.SFT_LLM_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GEMINI_API_KEY;
    delete process.env.OLLAMA_HOST;
    delete process.env.SFT_LLM_MODEL;
  });

  it("returns Anthropic when only ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const cfg = detectProvider();
    expect(cfg.provider).toBe("anthropic");
    expect(cfg.model).toBe("claude-sonnet-4-5");
    expect(cfg.apiKey).toBe("sk-ant-test");
  });

  it("returns openai-compatible when OPENAI_BASE_URL is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://api.together.xyz/v1";
    const cfg = detectProvider();
    expect(cfg.provider).toBe("openai-compatible");
    expect(cfg.baseUrl).toBe("https://api.together.xyz/v1");
  });

  it("returns ollama when OLLAMA_HOST is set", () => {
    process.env.OLLAMA_HOST = "http://localhost:11434";
    const cfg = detectProvider();
    expect(cfg.provider).toBe("ollama");
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
    expect(cfg.apiKey).toBe("ollama");
  });

  it("throws when no env vars are set", () => {
    expect(() => detectProvider()).toThrow("No LLM provider configured");
  });
});

describe("pricing", () => {
  it("lookupPricing returns default for known model", () => {
    const p = lookupPricing("claude-sonnet-4-5");
    expect(p.inputPerM).toBe(3.00);
    expect(p.outputPerM).toBe(15.00);
  });

  it("lookupPricing throws for unknown model", () => {
    expect(() => lookupPricing("unknown-model")).toThrow("Unknown model");
  });

  it("lookupPricing respects override", () => {
    const p = lookupPricing("unknown-model", { inputPerM: 1, outputPerM: 2 });
    expect(p.inputPerM).toBe(1);
    expect(p.outputPerM).toBe(2);
  });

  it("computeCostUsd computes correct total", () => {
    const pricing = { inputPerM: 3.00, outputPerM: 15.00 };
    const cost = computeCostUsd(
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 100, cacheCreationTokens: 0 },
      pricing,
    );
    const expected = (1000 * 3.00 + 100 * 3.00 * 0.1 + 0 * 3.00 * 1.25) / 1_000_000 + (500 * 15.00) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("DEFAULT_PRICING contains expected models", () => {
    expect(DEFAULT_PRICING["claude-sonnet-4-5"]).toBeDefined();
    expect(DEFAULT_PRICING["gpt-5"]).toBeDefined();
    expect(DEFAULT_PRICING["llama3.3"]).toBeDefined();
  });
});
