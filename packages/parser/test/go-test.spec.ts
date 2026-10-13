import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGoTest } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseGoTest", () => {
  it("extracts one finding per failed test", () => {
    const findings = parseGoTest(fixture("go-test-output.txt"), "");

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("example.com/foo::TestFoo");
    expect(findings[0].severity).toBe("error");
    expect(findings[0].category).toBe("test");
  });

  it("extracts file:line from the test output", () => {
    const findings = parseGoTest(fixture("go-test-output.txt"), "");

    expect(findings[0].file).toBe("foo_test.go");
    expect(findings[0].line).toBe(42);
    expect(findings[0].file.endsWith("foo_test.go")).toBe(true);
  });

  it("extracts the message from the assertion line", () => {
    const findings = parseGoTest(fixture("go-test-output.txt"), "");

    expect(findings[0].message).toBe("expected 1, got 2");
    expect(findings[0].message).toContain("expected 1, got 2");
  });

  it("ignores passing and skipping tests", () => {
    const findings = parseGoTest(fixture("go-test-output.txt"), "");

    expect(findings.some((f) => f.ruleId.includes("TestOK"))).toBe(false);
    expect(findings.some((f) => f.ruleId.includes("TestSkip"))).toBe(false);
  });

  it("returns [] on malformed JSON", () => {
    expect(parseGoTest("not json at all\n{broken", "")).toEqual([]);
  });
});
