import type { ParsedFinding } from "@sft/parser";

// Conservative estimates of how many tokens an AI agent burns to find/fix this manually.
const TOKENS_AVOIDED_BY_CATEGORY: Record<string, number> = {
  lint: 2000,
  typecheck: 4000,
  test: 8000,
  security: 5000,
  build: 6000,
};

export function estimateTokensAvoided(finding: ParsedFinding): number {
  // We assume the user's prompt to the agent included the raw error.
  const base = TOKENS_AVOIDED_BY_CATEGORY[finding.category] ?? 3000;
  // Subtract the tokens cicured actually used (we'll assume a flat 500 for the agent bypass)
  return Math.max(0, base - 500);
}
