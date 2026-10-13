import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseRuff } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseRuff", () => {
  it("extracts one finding per entry", () => {
    const findings = parseRuff(fixture("ruff-output.json"), "");

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.category === "lint")).toBe(true);
    expect(findings.map((f) => f.ruleId)).toEqual(["F401", "E501"]);
  });

  it("strips /workspace/repo/ prefix", () => {
    const findings = parseRuff(fixture("ruff-output.json"), "");

    expect(findings[0].file.startsWith("src/")).toBe(true);
    expect(findings[0].file).toBe("src/foo.py");
    expect(findings.every((f) => !f.file.startsWith("/workspace"))).toBe(true);
  });

  it("uses code as ruleId", () => {
    const findings = parseRuff(fixture("ruff-output.json"), "");

    expect(findings[0].ruleId).toBe("F401");
  });

  it("F codes are warnings", () => {
    const findings = parseRuff(fixture("ruff-output.json"), "");

    expect(findings[0].severity).toBe("warning");
    expect(findings[1].severity).toBe("warning");
    expect(findings[0].line).toBe(1);
    expect(findings[0].col).toBe(8);
  });

  it("returns empty array on invalid JSON", () => {
    expect(parseRuff("{not json", "")).toEqual([]);
  });
});