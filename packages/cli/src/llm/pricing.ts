import type { ModelPricing } from "@cicured/schemas";

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-5":  { inputPerM: 3.00,  outputPerM: 15.00 },
  "claude-haiku-4-5":   { inputPerM: 0.80,  outputPerM: 4.00 },
  "claude-opus-4-1":    { inputPerM: 15.00, outputPerM: 75.00 },
  "gpt-5":              { inputPerM: 2.50,  outputPerM: 10.00 },
  "gpt-5-mini":         { inputPerM: 0.25,  outputPerM: 2.00 },
  "gemini-2.5-pro":     { inputPerM: 1.25,  outputPerM: 10.00 },
  "gemini-2.5-flash":   { inputPerM: 0.30,  outputPerM: 2.50 },
  "llama3.3":           { inputPerM: 0,     outputPerM: 0 },
  "qwen2.5-coder":      { inputPerM: 0,     outputPerM: 0 },
};

export function lookupPricing(
  model: string,
  override?: ModelPricing,
): ModelPricing {
  if (override) return override;
  const p = DEFAULT_PRICING[model];
  if (p) return p;
  throw new Error(
    `Unknown model "${model}". Add pricing to sft-dev.config.json under "llm.pricing".`
  );
}

export function computeCostUsd(
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number },
  pricing: ModelPricing,
): number {
  // cache read is 10% of input price; cache creation is 125% of input price.
  const inputCost =
    (usage.inputTokens * pricing.inputPerM +
      usage.cacheReadTokens * pricing.inputPerM * 0.1 +
      usage.cacheCreationTokens * pricing.inputPerM * 1.25) /
    1_000_000;
  const outputCost = (usage.outputTokens * pricing.outputPerM) / 1_000_000;
  return inputCost + outputCost;
}