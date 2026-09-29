import { z } from "zod";
import { SHA256_HEX_PATTERN } from "./common";

export const FINDING_CATEGORIES = ["build", "typecheck", "lint", "test"] as const;
export const FindingCategory = z.enum(FINDING_CATEGORIES);
export type FindingCategory = z.infer<typeof FindingCategory>;

export const FINDING_SEVERITIES = ["error", "warning", "info"] as const;
export const FindingSeverity = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

/**
 * `rule_id` formats locked in Spec §5 — this is the contract for
 * `packages/parser` and must not drift.
 */
export const RULE_ID_PATTERNS: Record<
  FindingCategory,
  { source: string; pattern: RegExp; example: string }
> = {
  typecheck: { source: "tsc", pattern: /^TS\d{4,5}$/, example: "TS2339" },
  lint: {
    source: "eslint",
    pattern: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
    example: "@typescript-eslint/no-explicit-any",
  },
  test: {
    source: "jest / vitest",
    pattern: /^.+::.+$/,
    example: "src/a.test.ts::auth › rejects expired token",
  },
  build: {
    source: "next build",
    pattern: /^NEXT_BUILD_(?:[A-Za-z0-9_-]+)$/,
    example: "NEXT_BUILD_9f2c1ab4",
  },
};

export function isValidRuleId(category: FindingCategory, ruleId: string): boolean {
  return RULE_ID_PATTERNS[category].pattern.test(ruleId);
}

/**
 * Deterministic finding produced by the parser (no LLM) — Spec §4 step 8.
 * `fingerprint = sha256(rule_id ‖ file ‖ line-bucket ‖ message-normalized)`.
 */
export const Finding = z
  .object({
    severity: FindingSeverity,
    category: FindingCategory,
    ruleId: z.string().min(1).max(300),
    file: z.string().min(1).max(4096),
    line: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    message: z.string().min(1).max(10_000),
    fingerprint: z.string().regex(SHA256_HEX_PATTERN, "fingerprint must be sha256 hex"),
  })
  .superRefine((finding, ctx) => {
    if (!isValidRuleId(finding.category, finding.ruleId)) {
      ctx.addIssue({
        code: "custom",
        path: ["ruleId"],
        message: `ruleId "${finding.ruleId}" does not match the locked ${finding.category} format (Spec §5): ${RULE_ID_PATTERNS[finding.category].example}`,
      });
    }
  });

export type Finding = z.infer<typeof Finding>;
