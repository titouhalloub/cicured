import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/runner", () => ({ runRunner: vi.fn() }));

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
