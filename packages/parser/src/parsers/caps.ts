import type { ParsedFinding } from "../types";

/** Per-stream input cap: tails beyond 2 MB are dropped (attacker-controlled output). */
export const MAX_INPUT_CHARS = 2 * 1024 * 1024;
/** Hard cap on findings emitted per task. */
export const MAX_FINDINGS = 500;

export function capInput(input: string): { text: string; truncated: boolean } {
  if (input.length <= MAX_INPUT_CHARS) return { text: input, truncated: false };
  return { text: input.slice(0, MAX_INPUT_CHARS), truncated: true };
}

/** Reserve one slot so the synthetic truncation marker always fits. */
export function findingLimit(truncated: boolean): number {
  return truncated ? MAX_FINDINGS - 1 : MAX_FINDINGS;
}

export function truncatedFinding(category: ParsedFinding["category"]): ParsedFinding {
  return {
    severity: "warning",
    category,
    ruleId: "SFT_TRUNCATED",
    file: "<parser>",
    line: 0,
    col: 0,
    message: "parser input exceeded the 2 MB cap; output beyond the cap was not parsed",
  };
}