import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePytest } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parsePytest", () => {
  it("extracts one finding per failing test", () => {
    const findings = parsePytest(fixture("pytest-output.txt"), "");

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.category === "test")).toBe(true);
    expect(findings.map((f) => f.file)).toEqual(["tests/test_math.py", "tests/test_math.py"]);
  });

  it("ruleId is the full test path", () => {
    const findings = parsePytest(fixture("pytest-output.txt"), "");

    expect(findings[0].ruleId).toContain("::");
    expect(findings[0].ruleId).toBe("tests/test_math.py::test_sub");
    expect(findings[1].ruleId).toBe("tests/test_math.py::TestCalc::test_mul");
  });

  it("extracts the assertion line from the traceback", () => {
    const findings = parsePytest(fixture("pytest-output.txt"), "");

    expect(findings[0].message).toContain("assert");
    expect(findings[0].message).toBe("assert 0 == 1");
    // The location line of the first traceback block wins over the default.
    expect(findings[0].line).toBe(8);
    expect(findings[1].line).toBe(14);
  });

  it("ignores PASSED lines", () => {
    const findings = parsePytest(fixture("pytest-output.txt"), "");

    // Every finding is an error — nothing below error severity is emitted.
    expect(findings.every((f) => f.severity === "error")).toBe(true);
    expect(findings.some((f) => f.ruleId.includes("test_add"))).toBe(false);
    expect(findings.some((f) => f.ruleId.includes("test_skip"))).toBe(false);
  });

  it("returns empty array on malformed input", () => {
    expect(parsePytest("complete garbage\nnot a test line\n", "")).toEqual([]);
  });
});