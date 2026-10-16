import { describe, expect, it } from "vitest";
import { parseSemgrep } from "../src/index";

function finding(
  check_id: string,
  path: string,
  line: number,
  col: number,
  message: string,
  severity?: string,
) {
  return {
    check_id,
    path,
    start: { line, col },
    extra: { message, ...(severity ? { severity } : {}) },
  };
}

describe("parseSemgrep", () => {
  it("returns [] on empty string and records a warning", () => {
    const warnings: string[] = [];
    expect(parseSemgrep("", warnings)).toEqual([]);
    expect(warnings).toEqual(["semgrep: invalid JSON"]);
  });

  it("returns [] on invalid JSON and appends a warning", () => {
    const warnings: string[] = [];
    expect(parseSemgrep("{ not json", warnings)).toEqual([]);
    expect(warnings).toEqual(["semgrep: invalid JSON"]);
    warnings.push("preexisting");
    expect(parseSemgrep("also not json", warnings)).toEqual([]);
    expect(warnings).toEqual([
      "semgrep: invalid JSON",
      "preexisting",
      "semgrep: invalid JSON",
    ]);
  });

  it("maps ERROR severity to error", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [finding("r1", "a.ts", 3, 2, "boom", "ERROR")] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });

  it("maps WARNING severity to warning", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [finding("r1", "a.ts", 3, 2, "boom", "WARNING")] }),
    );
    expect(findings[0].severity).toBe("warning");
  });

  it("maps INFO severity to info", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [finding("r1", "a.ts", 3, 2, "boom", "INFO")] }),
    );
    expect(findings[0].severity).toBe("info");
  });

  it("defaults unknown severity to warning", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [finding("r1", "a.ts", 3, 2, "boom", "BOGUS")] }),
    );
    expect(findings[0].severity).toBe("warning");
  });

  it("skips a result missing check_id", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [{ path: "a.ts", start: { line: 1 }, extra: { message: "m" } }] }),
    );
    expect(findings).toEqual([]);
  });

  it("skips a result missing start.line", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [{ check_id: "r1", path: "a.ts", start: {}, extra: { message: "m" } }] }),
    );
    expect(findings).toEqual([]);
  });

  it("returns multiple results in input order", () => {
    const findings = parseSemgrep(
      JSON.stringify({
        results: [
          finding("r1", "a.ts", 1, 1, "first"),
          finding("r2", "b.ts", 2, 2, "second"),
          finding("r3", "c.ts", 3, 3, "third"),
        ],
      }),
    );
    expect(findings.map((f) => f.ruleId)).toEqual(["r1", "r2", "r3"]);
  });

  it("matches file/line/col/ruleId/message exactly", () => {
    const findings = parseSemgrep(
      JSON.stringify({ results: [finding("my-rule", "src/app.ts", 42, 7, "hello world")] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: "my-rule",
      file: "src/app.ts",
      line: 42,
      col: 7,
      message: "hello world",
    });
  });

  it("never throws on { results: 'not-an-array' }", () => {
    expect(() =>
      parseSemgrep(JSON.stringify({ results: "not-an-array" })),
    ).not.toThrow();
    expect(parseSemgrep(JSON.stringify({ results: "not-an-array" }))).toEqual([]);
  });
});
