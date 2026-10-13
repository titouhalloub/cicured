import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSemgrep } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseSemgrep", () => {
  it("extracts one finding per result", () => {
    const findings = parseSemgrep(fixture("semgrep-output.json"), "");

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.category === "lint")).toBe(true);
  });

  it("strips /workspace/repo/ from the path", () => {
    const findings = parseSemgrep(fixture("semgrep-output.json"), "");

    expect(findings[0].file).toBe("src/db.ts");
    expect(findings[1].file).toBe("app.py");
    expect(findings.some((f) => f.file.startsWith("/workspace"))).toBe(false);
  });

  it("uses check_id as ruleId", () => {
    const findings = parseSemgrep(fixture("semgrep-output.json"), "");

    expect(findings[0].ruleId).toBe("javascript.lang.security.audit.sqli.node-mysql-sqli");
  });

  it("maps ERROR severity to error", () => {
    const findings = parseSemgrep(fixture("semgrep-output.json"), "");

    expect(findings[0].severity).toBe("error");
  });

  it("maps MEDIUM severity to warning", () => {
    const findings = parseSemgrep(fixture("semgrep-output.json"), "");

    expect(findings[1].severity).toBe("warning");
  });

  it("extracts message and line:col from start", () => {
    const findings = parseSemgrep(fixture("semgrep-output.json"), "");

    expect(findings[0].line).toBe(42);
    expect(findings[0].col).toBe(5);
    expect(findings[0].message).toContain("SQL");
  });

  it("returns [] on malformed JSON", () => {
    expect(parseSemgrep("{not json", "")).toEqual([]);
  });

  it("returns [] when results is missing", () => {
    expect(parseSemgrep('{"version":"1.0"}', "")).toEqual([]);
  });
});
