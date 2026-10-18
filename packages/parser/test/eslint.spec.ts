import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEslint } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseEslint", () => {
  it("returns no findings for a clean run", () => {
    expect(parseEslint(fixture("eslint-clean.txt"), "")).toEqual([]);
  });

  it("parses many findings with correct severities, rules, and files", () => {
    const findings = parseEslint(fixture("eslint-many.txt"), "");

    expect(findings).toHaveLength(5);
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(4);
    expect(findings.filter((f) => f.severity === "warning")).toHaveLength(1);
    expect(findings.every((f) => f.category === "lint")).toBe(true);

    expect(findings.map((f) => f.ruleId)).toEqual([
      "no-unused-vars",
      "@typescript-eslint/explicit-function-return-type",
      "@typescript-eslint/no-explicit-any",
      "no-unused-vars",
      "parse-error",
    ]);

    // The sandbox prefix is stripped: files are repo-relative.
    expect(findings[0].file).toBe("apps/api/src/auth/session.ts");
    expect(findings[0].line).toBe(12);
    expect(findings[0].col).toBe(5);
    expect(findings[0].message).toBe("'createHash' is defined but never used");
    expect(findings.every((f) => !f.file.startsWith("/workspace/repo/"))).toBe(true);

    expect(findings[1]).toMatchObject({
      severity: "warning",
      file: "apps/api/src/auth/session.ts",
      ruleId: "@typescript-eslint/explicit-function-return-type",
    });

    // A stylish line without a rule column degrades to parse-error.
    expect(findings[4]).toEqual({
      severity: "error",
      category: "lint",
      ruleId: "parse-error",
      file: "apps/web/src/components/App.tsx",
      line: 1,
      col: 1,
      message: "Parsing error: Expected corresponding JSX closing tag for <div>",
    });
  });

  it("strips pnpm -r prefix and extracts findings", () => {
    const raw = [
      "packages/cli lint$ eslint .",
      "packages/cli lint: /workspace/repo/packages/cli/src/llm/anthropic.ts",
      "packages/cli lint:   4:10  error  'buildMessages' is defined but never used  @typescript-eslint/no-unused-vars",
      "packages/cli lint:   5:10  error  'lookupPricing' is defined but never used  @typescript-eslint/no-unused-vars",
      "packages/cli lint: Done",
    ].join("\n");
    const findings = parseEslint(raw, "");
    expect(findings).toHaveLength(2);
    expect(findings[0].file).toContain("anthropic.ts");
    expect(findings[0].line).toBe(4);
    expect(findings[0].col).toBe(10);
    expect(findings[0].ruleId).toBe("@typescript-eslint/no-unused-vars");
    expect(findings[1].line).toBe(5);
  });

  it("still parses raw eslint output without pnpm prefix", () => {
    const raw = [
      "/workspace/repo/src/foo.ts",
      "  1:5  error  'x' is defined but never used  no-unused-vars",
    ].join("\n");
    const findings = parseEslint(raw, "");
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/foo.ts");
    expect(findings[0].line).toBe(1);
    expect(findings[0].col).toBe(5);
  });
});