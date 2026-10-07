import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTsc } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseTsc", () => {
  it("returns no findings for a clean run", () => {
    expect(parseTsc(fixture("tsc-clean.txt"), "")).toEqual([]);
  });

  it("parses a single error with the exact fields", () => {
    const findings = parseTsc(fixture("tsc-single-error.txt"), "");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      severity: "error",
      category: "typecheck",
      ruleId: "TS2339",
      file: "apps/api/src/auth/github.client.ts",
      line: 87,
      col: 14,
      message: "Property 'clientId' does not exist on type 'AppConfig'.",
    });
  });

  it("parses many errors with correct severities and joined wrapped messages", () => {
    const findings = parseTsc(fixture("tsc-many-errors.txt"), "");

    expect(findings).toHaveLength(6);
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(5);
    expect(findings.filter((f) => f.severity === "warning")).toHaveLength(1);
    expect(findings.every((f) => f.category === "typecheck")).toBe(true);

    // The wrapped, indented second line is appended to the TS2345 finding.
    expect(findings[1]).toMatchObject({ ruleId: "TS2345", line: 20, col: 10 });
    expect(findings[1].message).toBe(
      "Argument of type 'string' is not assignable to parameter of type 'number'. " +
        "The expected type comes from parameter 'n' at line 15.",
    );

    expect(findings[2]).toMatchObject({
      severity: "warning",
      ruleId: "TS6385",
      file: "apps/web/src/App.tsx",
      line: 4,
      col: 1,
    });
  });
});