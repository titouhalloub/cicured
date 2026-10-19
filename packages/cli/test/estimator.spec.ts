import type { ParsedFinding } from "@sft/parser";
import { describe, expect, it } from "vitest";
import { estimateTokensAvoided } from "../src/storage/estimator";

const BASE: ParsedFinding = {
  severity: "error",
  category: "lint",
  ruleId: "@typescript-eslint/no-unused-vars",
  file: "src/x.ts",
  line: 1,
  col: 1,
  message: "'x' is defined but never used.",
};

describe("estimateTokensAvoided", () => {
  it("prices each category from the conservative table minus cicured's own burn", () => {
    expect(estimateTokensAvoided({ ...BASE, category: "lint" })).toBe(1500);
    expect(estimateTokensAvoided({ ...BASE, category: "typecheck" })).toBe(3500);
    expect(estimateTokensAvoided({ ...BASE, category: "test" })).toBe(7500);
    expect(estimateTokensAvoided({ ...BASE, category: "build" })).toBe(5500);
  });

  it("falls back to a generic estimate for categories outside the table", () => {
    const unknownCategory = { ...BASE, category: "docs" } as unknown as ParsedFinding;
    expect(estimateTokensAvoided(unknownCategory)).toBe(2500);
  });
});
