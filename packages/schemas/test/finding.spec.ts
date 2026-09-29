import { describe, expect, it } from "vitest";
import {
  FINDING_CATEGORIES,
  Finding,
  isValidRuleId,
  RULE_ID_PATTERNS,
  type FindingCategory,
} from "../src/index";

const FINGERPRINT = "a".repeat(64);

function finding(overrides: Record<string, unknown> = {}) {
  return {
    severity: "error",
    category: "typecheck",
    ruleId: "TS2339",
    file: "src/auth.ts",
    line: 42,
    col: 7,
    message: "Property 'sub' does not exist on type 'User'.",
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

describe("Finding", () => {
  it.each([
    ["typecheck", "TS2339"],
    ["lint", "no-unused-vars"],
    ["lint", "@typescript-eslint/no-explicit-any"],
    ["test", "src/a.test.ts::auth \u203a rejects expired token"],
    ["build", "NEXT_BUILD_9f2c1ab4"],
  ] as const)("accepts %s rule ids in the locked format (%s)", (category, ruleId) => {
    const result = Finding.safeParse(finding({ category, ruleId }));
    expect(result.success).toBe(true);
  });

  it.each([
    ["typecheck", "no-unused-vars"],
    ["lint", "TS2339"],
    ["test", "just-a-name-without-separator"],
    ["build", "NEXT_ERROR"],
  ] as const)("rejects a rule id outside the %s format (%s)", (category, ruleId) => {
    const result = Finding.safeParse(finding({ category, ruleId }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-sha256 fingerprint", () => {
    expect(Finding.safeParse(finding({ fingerprint: "abc123" })).success).toBe(false);
    expect(Finding.safeParse(finding({ fingerprint: "A".repeat(64) })).success).toBe(false);
  });

  it("rejects unknown categories and empty messages", () => {
    expect(Finding.safeParse(finding({ category: "security" })).success).toBe(false);
    expect(Finding.safeParse(finding({ message: "" })).success).toBe(false);
  });

  it("locks a rule-id pattern for every category", () => {
    expect(Object.keys(RULE_ID_PATTERNS).sort()).toEqual(
      [...FINDING_CATEGORIES].sort(),
    );
    for (const category of FINDING_CATEGORIES) {
      const { pattern, example } = RULE_ID_PATTERNS[category as FindingCategory];
      expect(pattern.test(example)).toBe(true);
      expect(isValidRuleId(category, example)).toBe(true);
    }
  });
});
