import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Namespace import, not a named one: @sft/schemas has no "type": "module"
// and no exports map, so Node's native ESM loader (via tsx) reads it as CJS
// and cjs-module-lexer cannot statically resolve the barrel `export *` chain.
// A namespace import exposes the detected exports at runtime.
import * as schemas from "@sft/schemas";
import type { SftReportV2 } from "@sft/schemas";
import { runRunner } from "../runner";
import { appendRun, type CacheRun } from "../storage/cache";
import { banner, fail, pass } from "../ui";

interface Flags {
  json: boolean;
  noCache: boolean;
}

function parseFlags(args: string[]): Flags {
  return {
    json: args.includes("--json"),
    noCache: args.includes("--no-cache"),
  };
}

/** Reads and validates `sft-report.json`. Returns null when absent/invalid. */
function readReport(cwd: string): SftReportV2 | null {
  const file = path.join(cwd, "sft-report.json");
  if (!existsSync(file)) return null;
  const parsed = schemas.parseSftReport(readFileSync(file, "utf8"));
  return parsed.ok ? parsed.report : null;
}

function toCacheRun(report: SftReportV2, exitCode: number): CacheRun {
  const finishedMs = Date.parse(report.finishedAt);
  const startedAt = Number.isFinite(finishedMs)
    ? new Date(finishedMs - report.summary.totalDurationMs).toISOString()
    : report.finishedAt;
  return {
    id: randomUUID(),
    startedAt,
    finishedAt: report.finishedAt,
    exitCode: exitCode === 0 || exitCode === 1 || exitCode === 2 ? exitCode : 1,
    summary: {
      total: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      skipped: report.summary.skipped,
    },
    tasks: report.tasks.map((task) => ({
      name: task.name,
      success: task.success,
      durationMs: task.durationMs,
    })),
  };
}

export async function runCommand(args: string[]): Promise<number> {
  const { json, noCache } = parseFlags(args);
  const cwd = process.cwd();

  const result = await runRunner([], { cwd });

  const report = readReport(cwd);
  if (!report) {
    // A missing or unparseable report means the runner itself crashed.
    return 2;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return result.exitCode;
  }

  process.stdout.write(`${banner(`run finished ${report.finishedAt}`)}\n`);
  for (const task of report.tasks) {
    const mark = task.success ? pass("pass") : fail("fail");
    process.stdout.write(`${mark} ${task.name} (${task.durationMs}ms)\n`);
  }
  process.stdout.write(
    `SUMMARY: ${report.summary.passed}/${report.summary.total} passed\n`,
  );

  if (!noCache) {
    appendRun(toCacheRun(report, result.exitCode));
  }

  return result.exitCode;
}
