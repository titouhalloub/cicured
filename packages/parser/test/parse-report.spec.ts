import type { SftReportV2, SftTaskV2 } from "@sft/schemas";
import { describe, expect, it } from "vitest";
import { computeFingerprint, parseReport } from "../src/index";

function task(overrides: Partial<SftTaskV2> & { name: string }): SftTaskV2 {
  return {
    command: "pnpm -r typecheck",
    success: false,
    exitCode: 2,
    timedOut: false,
    skipped: false,
    truncated: false,
    durationMs: 1000,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

function report(tasks: SftTaskV2[]): SftReportV2 {
  return {
    tool: "sft-dev",
    version: 2,
    finishedAt: "2026-10-07T12:00:00.000Z",
    runnerError: null,
    warnings: [],
    summary: {
      total: tasks.length,
      passed: 0,
      failed: tasks.length,
      skipped: 0,
      totalDurationMs: 1000,
    },
    tasks,
  };
}

describe("parseReport", () => {
  it("parses a Type Check task and attaches fingerprints", () => {
    const stdout = "src/index.ts(10,5): error TS2304: Cannot find name 'bar'.\n";

    const findings = parseReport(report([task({ name: "Type Check", stdout })]));

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding).toMatchObject({
      severity: "error",
      category: "typecheck",
      ruleId: "TS2304",
      file: "src/index.ts",
      line: 10,
      col: 5,
      message: "Cannot find name 'bar'.",
    });
    expect(finding.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    const { fingerprint, ...parsed } = finding;
    expect(fingerprint).toBe(computeFingerprint(parsed));
  });

  it("ignores a Lint task until M3b wires eslint", () => {
    const stdout = "src/a.ts(1,1): error no-unused-vars: 'x' is defined but never used.\n";

    expect(parseReport(report([task({ name: "Lint", stdout })]))).toEqual([]);
  });

  it("truncates >2MB stdout and emits one SFT_TRUNCATED finding", () => {
    const head = "src/index.ts(3,1): error TS1005: ';' expected.\n";
    const tail = "src/index.ts(9999,1): error TS2304: Cannot find name 'z'.\n";
    const padding = "x".repeat(2 * 1024 * 1024);

    const findings = parseReport(
      report([task({ name: "Type Check", stdout: head + padding + tail })]),
    );

    // Head parsed, tail beyond the 2 MB cap skipped, one synthetic marker.
    expect(findings.map((f) => f.ruleId)).toEqual(["TS1005", "SFT_TRUNCATED"]);
    expect(findings[1]).toMatchObject({ severity: "warning", category: "typecheck" });
    expect(findings[1].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});