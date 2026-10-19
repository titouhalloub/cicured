import { z } from "zod";

export const LlmProviderId = z.enum([
  "anthropic",
  "openai",
  "openai-compatible",
  "gemini",
  "ollama",
]);
export type LlmProviderId = z.infer<typeof LlmProviderId>;

export const LlmUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheCreationTokens: z.number().int().nonnegative().default(0),
  source: z.enum(["reported", "estimated"]),
});
export type LlmUsage = z.infer<typeof LlmUsage>;

export const ModelPricing = z.object({
  inputPerM: z.number().nonnegative(),
  outputPerM: z.number().nonnegative(),
});
export type ModelPricing = z.infer<typeof ModelPricing>;

export const LlmMode = z.enum(["explain", "fix", "suggest"]);
export type LlmMode = z.infer<typeof LlmMode>;

export const LlmCallRecord = z.object({
  provider: LlmProviderId,
  model: z.string().min(1),
  endpoint: z.string().url().optional(),
  mode: LlmMode,
  usage: LlmUsage,
  pricing: ModelPricing,
  totalCostUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** Finding context the CLI attaches at the call site (cost-avoidance card). */
  ruleId: z.string().optional(),
  category: z.string().optional(),
  estimatedTokensAvoided: z.number().int().nonnegative().optional(),
});
export type LlmCallRecord = z.infer<typeof LlmCallRecord>;