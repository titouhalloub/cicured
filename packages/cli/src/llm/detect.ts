import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { LlmProviderId, ModelPricing } from "@sft/schemas";
import type { ProviderConfig } from "./types";
import { lookupPricing } from "./pricing";

const PROVIDER_IDS = ["anthropic", "openai", "openai-compatible", "gemini", "ollama"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is LlmProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

function parsePricing(value: unknown): ModelPricing | undefined {
  if (!isRecord(value)) return undefined;
  const { inputPerM, outputPerM } = value;
  if (typeof inputPerM !== "number" || !Number.isFinite(inputPerM) || inputPerM < 0) return undefined;
  if (typeof outputPerM !== "number" || !Number.isFinite(outputPerM) || outputPerM < 0) return undefined;
  return { inputPerM, outputPerM };
}

export function detectProvider(): ProviderConfig {
  // 1. Explicit override
  const override = process.env.SFT_LLM_PROVIDER;

  // Try config file first (highest user intent)
  const cfg = tryReadConfig();
  if (cfg?.llm) {
    return resolveConfig(cfg.llm);
  }

  // Then env-var detection in priority order
  if (override === "anthropic" || process.env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      model: process.env.SFT_LLM_MODEL ?? "claude-sonnet-4-5",
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      pricing: lookupPricing(process.env.SFT_LLM_MODEL ?? "claude-sonnet-4-5"),
    };
  }
  if (override === "openai" || process.env.OPENAI_API_KEY) {
    const baseUrl = process.env.OPENAI_BASE_URL;
    return {
      provider: baseUrl ? "openai-compatible" : "openai",
      model: process.env.SFT_LLM_MODEL ?? "gpt-5",
      baseUrl: baseUrl ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY ?? "",
      pricing: lookupPricing(process.env.SFT_LLM_MODEL ?? "gpt-5"),
    };
  }
  if (override === "gemini" || process.env.GEMINI_API_KEY) {
    return {
      provider: "gemini",
      model: process.env.SFT_LLM_MODEL ?? "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY ?? "",
      pricing: lookupPricing(process.env.SFT_LLM_MODEL ?? "gemini-2.5-flash"),
    };
  }
  if (override === "ollama" || process.env.OLLAMA_HOST) {
    const host = (process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "");
    return {
      provider: "ollama",
      model: process.env.SFT_LLM_MODEL ?? "llama3.3",
      baseUrl: `${host}/v1`,
      apiKey: "ollama",
      pricing: lookupPricing(process.env.SFT_LLM_MODEL ?? "llama3.3"),
    };
  }

  throw new Error(
    "No LLM provider configured.\n" +
      "Set one of:\n" +
      "  ANTHROPIC_API_KEY   (Anthropic)\n" +
      "  OPENAI_API_KEY      (OpenAI, Azure, or any OpenAI-compatible; use OPENAI_BASE_URL for non-OpenAI)\n" +
      "  GEMINI_API_KEY      (Google Gemini)\n" +
      "  OLLAMA_HOST         (local Ollama, e.g. http://localhost:11434)\n" +
      'Or add "llm": { provider, model, apiKey or apiKeyEnv, baseUrl?, pricing? } to sft-dev.config.json.',
  );
}

function tryReadConfig(): { llm?: unknown } | null {
  const configPath = path.join(process.cwd(), "sft-dev.config.json");
  if (!existsSync(configPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!isRecord(parsed)) return null;
    return { llm: parsed.llm };
  } catch {
    return null;
  }
}

function resolveConfig(value: unknown): ProviderConfig {
  if (!isRecord(value)) throw new Error("llm must be an object in sft-dev.config.json");

  const provider = value.provider;
  if (!isProviderId(provider)) {
    throw new Error(`llm.provider must be one of: ${PROVIDER_IDS.join(", ")}`);
  }
  const model = value.model;
  if (typeof model !== "string" || model.length === 0) {
    throw new Error("llm.model is required");
  }

  const apiKeyEnv = typeof value.apiKeyEnv === "string" ? value.apiKeyEnv : undefined;
  const configuredApiKey = typeof value.apiKey === "string" ? value.apiKey : "";
  const apiKey = (apiKeyEnv ? process.env[apiKeyEnv] : undefined) || configuredApiKey;
  if (!apiKey && provider !== "ollama") {
    throw new Error(`No API key found for provider "${provider}". Set ${apiKeyEnv ?? "llm.apiKey"}.`);
  }

  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl : undefined;
  const pricing = parsePricing(value.pricing);
  if (value.pricing !== undefined && pricing === undefined) {
    throw new Error("llm.pricing must contain non-negative numeric inputPerM and outputPerM values");
  }

  return {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    apiKey,
    pricing: lookupPricing(model, pricing),
  };
}