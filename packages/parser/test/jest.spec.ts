import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJest } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseJest", () => {
  it("returns no findings for a clean run", () => {
    expect(parseJest(fixture("jest-clean.txt"), "")).toEqual([]);
  });

  it("parses vitest and jest failures with <file>::<test name> rule ids", () => {
    const findings = parseJest(fixture("jest-many.txt"), "");

    expect(findings).toHaveLength(4);
    expect(findings.every((f) => f.severity === "error")).toBe(true);
    expect(findings.every((f) => f.category === "test")).toBe(true);
    expect(findings.every((f) => f.line === 0 && f.col === 0)).toBe(true);

    expect(findings.map((f) => f.ruleId)).toEqual([
      "test/auth.spec.ts::rejects expired token",
      "test/auth.spec.ts::accepts refresh token",
      "src/users.test.ts::users › rejects expired token",
      "src/users.test.ts::users › renders profile",
    ]);

    expect(findings.map((f) => f.file)).toEqual([
      "test/auth.spec.ts",
      "test/auth.spec.ts",
      "src/users.test.ts",
      "src/users.test.ts",
    ]);

    // Vitest messages come from the `→` line; jest messages from the block
    // under `●` (first non-blank line).
    expect(findings.map((f) => f.message)).toEqual([
      "expected 'invalid' to be 'expired'",
      "expected 401 to be 200",
      "expect(received).toBe(expected)",
      'Expected: "active"',
    ]);
  });
});