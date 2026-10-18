import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ProviderConfig } from "./types";
import { lookupPricing } from "./pricing";

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

function tryReadConfig(): any {
  const p = path.join(process.cwd(), "sft-dev.config.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function resolveConfig(llm: any): ProviderConfig {
  const provider = llm.provider as string;
  if (!provider) throw new Error("llm.provider is required when llm is set in config");
  const model = llm.model as string;
  if (!model) throw new Error("llm.model is required");
  const apiKey =
    (llm.apiKeyEnv && process.env[llm.apiKeyEnv as string]) ||
    (llm.apiKey as string) ||
    "";
  if (!apiKey && provider !== "ollama") {
    throw new Error(`No API key found for provider "${provider}". Set ${llm.apiKeyEnv ?? "llm.apiKey"}.`);
  }
  return {
    provider: provider as any,
    model,
    baseUrl: llm.baseUrl,
    apiKey,
    pricing: lookupPricing(model, llm.pricing),
  };
}