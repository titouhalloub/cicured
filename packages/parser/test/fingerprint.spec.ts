import { describe, expect, it } from "vitest";
import { bucketLine, computeFingerprint, normalizeMessage } from "../src/index";
import type { ParsedFinding } from "../src/index";

function finding(overrides: Partial<ParsedFinding> = {}): ParsedFinding {
  return {
    severity: "error",
    category: "typecheck",
    ruleId: "TS2339",
    file: "apps/api/src/foo.ts",
    line: 42,
    col: 7,
    message: "Property 'x' does not exist on type 'AppConfig'.",
    ...overrides,
  };
}

describe("bucketLine", () => {
  it("buckets lines in groups of five", () => {
    expect(bucketLine(0)).toBe(0);
    expect(bucketLine(4)).toBe(0);
    expect(bucketLine(5)).toBe(5);
    expect(bucketLine(11)).toBe(10);
  });
});

describe("normalizeMessage", () => {
  it("collapses internal whitespace and trims", () => {
    expect(normalizeMessage("  Property 'x'\tat    line foo  \n")).toBe(
      "Property 'x' at line foo",
    );
  });

  it("replaces digit runs with a single hash", () => {
    expect(normalizeMessage("error at line 42 col 7")).toBe("error at line # col #");
  });
});

describe("computeFingerprint", () => {
  it("produces a stable 64-char hex value", () => {
    const first = computeFingerprint(finding());
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(computeFingerprint(finding())).toBe(first);
  });

  it("matches for close lines and digit-only message changes", () => {
    const a = computeFingerprint(finding({ line: 42, message: "Property 'x' at line 42" }));
    const b = computeFingerprint(finding({ line: 43, message: "Property 'x' at line 43" }));
    expect(a).toBe(b);
  });

  it("changes when ruleId changes", () => {
    expect(computeFingerprint(finding({ ruleId: "TS2345" }))).not.toBe(
      computeFingerprint(finding()),
    );
  });

  it("changes when file changes", () => {
    expect(computeFingerprint(finding({ file: "apps/api/src/bar.ts" }))).not.toBe(
      computeFingerprint(finding()),
    );
  });
});