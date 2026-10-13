import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/runner", () => ({ runRunner: vi.fn() }));
// Spy on parseReport only: the real parser still runs by default, so the
// existing tests are untouched; the gating tests stub per-finding results.
vi.mock("@sft/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof ParserModule>();
  return { ...actual, parseReport: vi.fn(actual.parseReport) };
});

import { parseReport, type FindingsWithFingerprint } from "@sft/parser";
import type * as ParserModule from "@sft/parser";
import { runRunner } from "../../src/runner";
import { runCommand } from "../../src/commands/run";

const REPORT = {
  tool: "sft-dev",
  version: 2,
  finishedAt: "2026-01-01T00:00:04.200Z",
  runnerError: null,
  warnings: [],
  summary: { total: 2, passed: 1, failed: 1, skipped: 0, totalDurationMs: 5_000 },
  tasks: [
    {
      name: "Type Check",
      command: "tsc --noEmit",
      success: true,
      exitCode: 0,
      timedOut: false,
      skipped: false,
      truncated: false,
      durationMs: 4_200,
      stdout: "",
      stderr: "",
    },
    {
      name: "Lint",
      command: "eslint .",
      success: false,
      exitCode: 1,
      timedOut: false,
      skipped: false,
      truncated: false,
      durationMs: 800,
      stdout: "",
      stderr: "",
    },
  ],
};

interface CachedSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

interface CachedRun {
  exitCode: number;
  summary: CachedSummary;
}

let dir: string;
let written: string[];

function cacheFile(): string {
  return path.join(dir, ".sft", "cache.json");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sft-run-"));
  written = [];
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  // Call history only — keeps the real parseReport as the default impl.
  vi.mocked(parseReport).mockClear();
  // Stands in for the runner: writes the report the CLI then reads back.
  vi.mocked(runRunner).mockImplementation(async () => {
    writeFileSync(path.join(dir, "sft-report.json"), JSON.stringify(REPORT), "utf8");
    return { exitCode: 1, stdout: "", stderr: "" };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("runCommand", () => {
  it("returns the runner exit code and appends a cache entry", async () => {
    expect(await runCommand([])).toBe(1);

    expect(vi.mocked(runRunner)).toHaveBeenCalledWith([], { cwd: dir });
    expect(existsSync(cacheFile())).toBe(true);

    const cache: { version: number; runs: CachedRun[] } = JSON.parse(
      readFileSync(cacheFile(), "utf8"),
    );
    expect(cache.runs).toHaveLength(1);
    expect(cache.runs[0]!.exitCode).toBe(1);
    expect(cache.runs[0]!.summary.passed).toBe(1);

    const out = written.join("");
    expect(out).toContain("SUMMARY: 1/2 passed");
    expect(out).toContain("Type Check (4200ms)");
  });

  it("--json prints only the report JSON", async () => {
    expect(await runCommand(["--json"])).toBe(1);

    expect(JSON.parse(written.join(""))).toMatchObject({
      tool: "sft-dev",
      version: 2,
      summary: { total: 2, passed: 1 },
    });
    expect(written.join("")).not.toContain("SUMMARY:");
    // No cache write in --json mode either.
    expect(existsSync(cacheFile())).toBe(false);
  });

  it("--no-cache skips the cache write", async () => {
    expect(await runCommand(["--no-cache"])).toBe(1);
    expect(existsSync(cacheFile())).toBe(false);
  });

  it("returns 2 when no report was produced", async () => {
    vi.mocked(runRunner).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    expect(await runCommand([])).toBe(2);
  });
});

describe("runCommand --fail-on gating", () => {
  function finding(
    severity: "error" | "warning" | "info",
    ruleId: string,
  ): FindingsWithFingerprint {
    return {
      severity,
      category: "typecheck",
      ruleId,
      file: "src/app.ts",
      line: 1,
      col: 1,
      message: "stub finding",
      fingerprint: `fp-${severity}-${ruleId}`,
    };
  }

  /** Runner exit 0 (or the given code) plus a stubbed findings list. */
  function stubRunner(options: {
    exitCode?: number;
    findings?: FindingsWithFingerprint[];
  }): void {
    vi.mocked(runRunner).mockImplementation(async () => {
      writeFileSync(path.join(dir, "sft-report.json"), JSON.stringify(REPORT), "utf8");
      return { exitCode: options.exitCode ?? 0, stdout: "", stderr: "" };
    });
    if (options.findings) vi.mocked(parseReport).mockReturnValueOnce(options.findings);
  }

  it("exit 0 when no --fail-on flags and runner passes", async () => {
    stubRunner({
      findings: [finding("error", "TS2339"), finding("warning", "no-unused-vars"), finding("info", "note")],
    });

    expect(await runCommand([])).toBe(0);
  });

  it("exit 1 when --fail-on-severity=error and an error finding is present", async () => {
    stubRunner({ findings: [finding("warning", "no-unused-vars"), finding("error", "TS2339")] });

    expect(await runCommand(["--fail-on-severity=error"])).toBe(1);
  });

  it("exit 0 when --fail-on-severity=error and only warnings present", async () => {
    stubRunner({ findings: [finding("warning", "no-unused-vars"), finding("info", "note")] });

    expect(await runCommand(["--fail-on-severity=error"])).toBe(0);
  });

  it("exit 1 when --fail-on-severity=warning and an error finding is present", async () => {
    // Severity ordering: error >= warning, so an error fails the warning gate.
    stubRunner({ findings: [finding("error", "TS2339")] });

    expect(await runCommand(["--fail-on-severity=warning"])).toBe(1);
  });

  it("exit 1 when --fail-on-rule=TS2339 and that rule fires", async () => {
    stubRunner({ findings: [finding("warning", "TS2339")] });

    expect(await runCommand(["--fail-on-rule=TS2339"])).toBe(1);
  });

  it("exit 0 when --fail-on-rule=TS2339 and no finding matches", async () => {
    stubRunner({ findings: [finding("error", "TS2345"), finding("warning", "no-unused-vars")] });

    expect(await runCommand(["--fail-on-rule=TS2339"])).toBe(0);
  });

  it("exit 1 when --fail-on-count=0 and any findings present", async () => {
    stubRunner({ findings: [finding("info", "note")] });

    expect(await runCommand(["--fail-on-count=0"])).toBe(1);
  });

  it("exit 0 when --fail-on-count=5 and only 3 findings present", async () => {
    stubRunner({
      findings: [finding("error", "TS2345"), finding("warning", "no-unused-vars"), finding("info", "note")],
    });

    expect(await runCommand(["--fail-on-count=5"])).toBe(0);
  });

  it("runner exit 1 overrides --fail-on-count=999", async () => {
    stubRunner({
      exitCode: 1,
      findings: [finding("error", "TS2345"), finding("warning", "no-unused-vars"), finding("info", "note")],
    });

    expect(await runCommand(["--fail-on-count=999"])).toBe(1);
  });
});
