import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGoVet } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("parseGoVet", () => {
  it("extracts one finding per vet diagnostic", () => {
    const findings = parseGoVet(fixture("go-vet-output.txt"), "");

    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.category === "lint")).toBe(true);
  });

  it("skips package header lines", () => {
    const findings = parseGoVet(fixture("go-vet-output.txt"), "");

    expect(findings.some((f) => f.message.includes("example.com"))).toBe(false);
    expect(findings.every((f) => f.file.endsWith(".go"))).toBe(true);
  });

  it("extracts file:line:col", () => {
    const findings = parseGoVet(fixture("go-vet-output.txt"), "");

    expect(findings[0].file).toBe("foo.go");
    expect(findings[0].line).toBe(42);
    expect(findings[0].col).toBe(5);
  });

  it("ruleId is go-vet", () => {
    const findings = parseGoVet(fixture("go-vet-output.txt"), "");

    expect(findings.every((f) => f.ruleId === "go-vet")).toBe(true);
  });

  it("returns [] on empty input", () => {
    expect(parseGoVet("", "")).toEqual([]);
  });
});
