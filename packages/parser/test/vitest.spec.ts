import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseVitest } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseVitest", () => {
  it("returns no findings for a clean run", () => {
    expect(parseVitest(fixture("vitest-clean.txt"), "")).toEqual([]);
  });

  it("parses many findings with correct files and test names", () => {
    const findings = parseVitest(fixture("vitest-many.txt"), "");

    expect(findings).toHaveLength(4);
    expect(findings.every((f) => f.category === "test")).toBe(true);
    expect(findings.every((f) => f.severity === "error")).toBe(true);

    // First file from vitest header ❯ line
    expect(findings[0].file).toBe("test/auth.spec.ts");
    expect(findings[0].ruleId).toBe("test/auth.spec.ts::rejects expired token");
    expect(findings[0].message).toBe("expected 'invalid' to be 'expired'");

    expect(findings[1].file).toBe("test/auth.spec.ts");
    expect(findings[1].ruleId).toBe("test/auth.spec.ts::accepts refresh token");
    expect(findings[1].message).toBe("expected 401 to be 200");

    expect(findings[2].file).toBe("test/users.spec.ts");
    expect(findings[2].ruleId).toBe("test/users.spec.ts::users › rejects expired token");
    expect(findings[2].message).toBe("expect(received).toBe(expected)");
  });

  it("strips pnpm prefix and extracts findings", () => {
    const raw = fixture("vitest-pnpm-prefixed.txt");
    const findings = parseVitest(raw, "");

    expect(findings).toHaveLength(2);
    expect(findings[0].file).toBe("test/auth.spec.ts");
    expect(findings[0].ruleId).toBe("test/auth.spec.ts::rejects expired token");
    expect(findings[0].message).toBe("expected 'invalid' to be 'expired'");
    expect(findings[1].ruleId).toBe("test/auth.spec.ts::accepts refresh token");
    expect(findings[1].message).toBe("expected 401 to be 200");
  });

  it("handles empty input without throwing", () => {
    expect(parseVitest("", "")).toEqual([]);
  });

  it("handles malformed input without throwing", () => {
    expect(parseVitest("garbage\nmore garbage\n", "")).toEqual([]);
  });

  it("includes truncation marker when input exceeds cap", () => {
    const longLine = "x".repeat(3000000);
    const findings = parseVitest(longLine, "");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[findings.length - 1].ruleId).toBe("SFT_TRUNCATED");
  });
});