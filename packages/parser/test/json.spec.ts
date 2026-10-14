import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJson } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

/** Field map for the `json-output.json` fixture (dot-paths into each item). */
const CONFIG = {
  path: "results",
  fields: {
    file: "file",
    line: "loc.line",
    col: "loc.col",
    message: "message",
    severity: "level",
    ruleId: "rule",
  },
  severityMap: { ERROR: "error", NOTICE: "info" },
  defaultSeverity: "warning",
} as const;

describe("parseJson", () => {
  it("extracts one finding per array item", () => {
    const findings = parseJson(fixture("json-output.json"), "", "", CONFIG);

    expect(findings).toHaveLength(2);
  });

  it("walks the configured path to the array", () => {
    const findings = parseJson(fixture("json-output.json"), "", "", CONFIG);

    expect(findings.every((f) => f.file.endsWith(".ts") || f.file.endsWith(".py"))).toBe(true);
  });

  it("maps nested dot-paths for file/line/col/message/ruleId", () => {
    const findings = parseJson(fixture("json-output.json"), "", "", CONFIG);

    expect(findings[0]).toEqual({
      severity: "error",
      category: "lint",
      ruleId: "SQL-INJECTION",
      file: "src/db.ts",
      line: 42,
      col: 5,
      message: "unsanitized SQL query",
    });
    expect(findings[1].line).toBe(10);
    expect(findings[1].col).toBe(1);
  });

  it("strips /workspace/repo/ and any leading slash from the path", () => {
    const findings = parseJson(fixture("json-output.json"), "", "", CONFIG);

    expect(findings[0].file).toBe("src/db.ts");
    expect(findings[1].file).toBe("src/api.py");
    expect(findings.some((f) => f.file.startsWith("/"))).toBe(false);
  });

  it("maps severities through severityMap, case-insensitively", () => {
    const findings = parseJson(fixture("json-output.json"), "", "", CONFIG);

    expect(findings[0].severity).toBe("error");
    expect(findings[1].severity).toBe("info");
  });

  it("falls back to defaultSeverity for unmapped severities", () => {
    const findings = parseJson(fixture("json-output.json"), "", "", {
      ...CONFIG,
      severityMap: {},
    });

    expect(findings.every((f) => f.severity === "warning")).toBe(true);
  });

  it("falls back to defaultCategory, defaultRuleId and defaults", () => {
    const findings = parseJson('[{ "p": "a/b.ts" }]', "", "", {
      fields: { file: "p" },
      defaultCategory: "test",
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      severity: "warning",
      category: "test",
      ruleId: "custom",
      file: "a/b.ts",
      line: 1,
      col: 1,
      message: "finding",
    });
  });

  it("uses the top level as the array when path is absent", () => {
    const findings = parseJson('[{ "f": "a.ts", "m": "boom" }]', "", "", {
      fields: { file: "f", message: "m" },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe("boom");
  });

  it("returns [] on malformed JSON", () => {
    expect(parseJson("{not json", "", "", CONFIG)).toEqual([]);
  });

  it("returns [] when the configured path is not an array", () => {
    expect(parseJson('{"results": "nope"}', "", "", CONFIG)).toEqual([]);
  });

  it("returns [] on an invalid config", () => {
    expect(parseJson(fixture("json-output.json"), "", "", undefined)).toEqual([]);
    expect(parseJson(fixture("json-output.json"), "", "", {})).toEqual([]);
    expect(parseJson(fixture("json-output.json"), "", "", { fields: { file: "" } })).toEqual([]);
    expect(
      parseJson(fixture("json-output.json"), "", "", {
        fields: { file: "file" },
        defaultSeverity: "nope",
      }),
    ).toEqual([]);
  });

  it("skips non-object array items", () => {
    const findings = parseJson('[{ "f": "a.ts" }, "junk", null, 3]', "", "", {
      fields: { file: "f" },
    });

    expect(findings).toHaveLength(1);
  });
});
