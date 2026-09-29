import { describe, expect, it } from "vitest";
import { PARSER_LIMITS, parseSftReport, SftReportV2 } from "../src/index";

type Json = Record<string, unknown>;

function task(overrides: Json = {}): Json {
  return {
    name: "Tests",
    command: "npm test -- --passWithNoTests",
    success: true,
    exitCode: 0,
    timedOut: false,
    skipped: false,
    truncated: false,
    durationMs: 1234,
    stdout: "Tests: 3 passed, 3 total\n",
    stderr: "",
    ...overrides,
  };
}

function report(overrides: Json = {}): Json {
  return {
    tool: "sft-dev",
    version: 2,
    finishedAt: "2026-09-28T12:00:00.000Z",
    runnerError: null,
    warnings: [],
    summary: { total: 1, passed: 1, failed: 0, skipped: 0, totalDurationMs: 1234 },
    tasks: [task()],
    ...overrides,
  };
}

describe("SftReportV2", () => {
  it("accepts a realistic passing report", () => {
    const result = SftReportV2.safeParse(report());
    expect(result.success).toBe(true);
  });

  it("accepts additive fields from future runner versions (version stays 2)", () => {
    const result = SftReportV2.safeParse(
      report({
        futureField: { anything: true },
        tasks: [task({ futureTaskField: 1 })],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("accepts a skipped task with null exitCode and a reason in stderr", () => {
    const result = SftReportV2.safeParse(
      report({
        summary: { total: 2, passed: 1, failed: 0, skipped: 1, totalDurationMs: 900 },
        tasks: [
          task(),
          task({
            name: "Build",
            command: "npm run build",
            success: false,
            exitCode: null,
            skipped: true,
            durationMs: 0,
            stdout: "",
            stderr: "global deadline exceeded",
          }),
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it.each([
    ["version 1", report({ version: 1 })],
    ["a foreign tool name", report({ tool: "other-runner" })],
    ["a missing warnings array", report({ warnings: undefined })],
    ["a non-ISO finishedAt", report({ finishedAt: "yesterday" })],
  ])("rejects %s", (_label, input) => {
    expect(SftReportV2.safeParse(input).success).toBe(false);
  });

  it("rejects a task stream above the parser cap", () => {
    const oversized = "x".repeat(PARSER_LIMITS.maxTaskStreamChars + 1);
    const result = SftReportV2.safeParse(report({ tasks: [task({ stdout: oversized })] }));
    expect(result.success).toBe(false);
  });
});

describe("parseSftReport", () => {
  it("parses a JSON string produced by the runner", () => {
    const result = parseSftReport(JSON.stringify(report()));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.summary.passed).toBe(1);
    }
  });

  it("rejects input above the report byte cap", () => {
    const padding = "x".repeat(PARSER_LIMITS.maxReportBytes + 1);
    const result = parseSftReport(JSON.stringify(report({ tasks: [], padding })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("exceeds");
    }
  });

  it("rejects malformed JSON without throwing", () => {
    const result = parseSftReport("{ not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not valid JSON");
    }
  });

  it("reports schema errors with paths", () => {
    const result = parseSftReport({ tool: "sft-dev", version: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("version");
    }
  });
});
