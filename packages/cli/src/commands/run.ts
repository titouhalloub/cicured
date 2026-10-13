import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Namespace import, not a named one: @sft/schemas has no "type": "module"
// and no exports map, so Node's native ESM loader (via tsx) reads it as CJS
// and cjs-module-lexer cannot statically resolve the barrel `export *` chain.
// A namespace import exposes the detected exports at runtime.
import * as schemas from "@sft/schemas";
import type { SftReportV2 } from "@sft/schemas";
import { parseReport, type FindingsWithFingerprint } from "@sft/parser";
import { runRunner } from "../runner";
import { appendRun, type CacheRun } from "../storage/cache";
import { banner, fail, pass } from "../ui";

interface Flags {
  json: boolean;
  noCache: boolean;
  failOnSeverity: "error" | "warning" | "info" | null;
  failOnRules: string[];
  failOnCount: number | null;
}

/** Hard cap on findings printed in the human-readable summary. */
const FINDINGS_PRINT_LIMIT = 20;

/** Truncates a message at 80 chars, appending an ellipsis. */
function formatMessage(message: string): string {
  return message.length > 80 ? `${message.slice(0, 79)}…` : message;
}

/** Prints the findings section: `── Findings (N) ──` plus numbered rows. */
function printFindings(findings: FindingsWithFingerprint[]): void {
  process.stdout.write(`${banner(`Findings (${findings.length})`)}\n`);
  const shown = findings.slice(0, FINDINGS_PRINT_LIMIT);
  shown.forEach((finding, index) => {
    const location = `${finding.file}:${finding.line}:${finding.col}`;
    process.stdout.write(
      `  #${index + 1}  ${finding.severity.padEnd(7)} ${finding.category.padEnd(9)}  ` +
        `${location.padEnd(19)}${finding.ruleId.padEnd(16)}${formatMessage(finding.message)}\n`,
    );
  });
  if (findings.length > FINDINGS_PRINT_LIMIT) {
    process.stdout.write(`  … and ${findings.length - FINDINGS_PRINT_LIMIT} more\n`);
  }
}

/** Flag usage printed to stderr when a --fail-on-* value is invalid. */
const RUN_USAGE =
  "Usage: sft run [--json] [--no-cache] [--fail-on-severity=<error|warning|info>] " +
  "[--fail-on-rule=<ruleId>]... [--fail-on-count=<n>]\n";

/**
 * Parses the sft run flags. Returns null when a --fail-on-* value is invalid
 * so the caller can print usage and exit 1. Unknown args stay ignored, as
 * they were before the gating flags existed.
 */
function parseFlags(args: string[]): Flags | null {
  const flags: Flags = {
    json: false,
    noCache: false,
    failOnSeverity: null,
    failOnRules: [],
    failOnCount: null,
  };
  for (const arg of args) {
    if (arg === "--json") {
      flags.json = true;
    } else if (arg === "--no-cache") {
      flags.noCache = true;
    } else if (arg.startsWith("--fail-on-severity=")) {
      const value = arg.slice("--fail-on-severity=".length);
      if (value !== "error" && value !== "warning" && value !== "info") return null;
      flags.failOnSeverity = value;
    } else if (arg.startsWith("--fail-on-rule=")) {
      flags.failOnRules.push(arg.slice("--fail-on-rule=".length));
    } else if (arg.startsWith("--fail-on-count=")) {
      const value = arg.slice("--fail-on-count=".length);
      if (!/^\d+$/.test(value)) return null;
      flags.failOnCount = Number.parseInt(value, 10);
    }
  }
  return flags;
}

/** Ordering for --fail-on-severity: error(2) > warning(1) > info/unknown(0). */
function severityRank(s: string): number {
  if (s === "error") return 2;
  if (s === "warning") return 1;
  return 0;
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
  const flags = parseFlags(args);
  if (flags === null) {
    process.stderr.write(RUN_USAGE);
    return 1;
  }
  const { json, noCache, failOnSeverity, failOnRules, failOnCount } = flags;
  const cwd = process.cwd();

  const result = await runRunner([], { cwd });

  const report = readReport(cwd);
  if (!report) {
    // A missing or unparseable report means the runner itself crashed.
    return 2;
  }

  // Best-effort: a parser error must never fail the run itself.
  let findings: FindingsWithFingerprint[] | null;
  try {
    findings = parseReport(report);
  } catch {
    findings = null;
  }

  // Gating (--fail-on-* flags): only consulted when the runner itself passed,
  // so a real runner failure keeps its exit code. A null findings list (parse
  // error) is treated as [] — every condition is then vacuously false.
  let code = result.exitCode;
  if (code === 0) {
    const list = findings ?? [];
    const failsOnSeverity =
      failOnSeverity !== null &&
      list.some((f) => severityRank(f.severity) >= severityRank(failOnSeverity));
    const failsOnRule =
      failOnRules.length > 0 && list.some((f) => failOnRules.includes(f.ruleId));
    const failsOnCount = failOnCount !== null && list.length > failOnCount;
    if (failsOnSeverity || failsOnRule || failsOnCount) {
      code = 1;
    }
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...report, findings: findings ?? [] }, null, 2)}\n`,
    );
    return code;
  }

  process.stdout.write(`${banner(`run finished ${report.finishedAt}`)}\n`);
  for (const task of report.tasks) {
    const mark = task.success ? pass("pass") : fail("fail");
    process.stdout.write(`${mark} ${task.name} (${task.durationMs}ms)\n`);
  }
  process.stdout.write(
    `SUMMARY: ${report.summary.passed}/${report.summary.total} passed\n`,
  );

  if (findings === null) {
    process.stdout.write("  (could not parse report)\n");
  } else {
    printFindings(findings);
  }

  if (!noCache) {
    appendRun(toCacheRun(report, result.exitCode));
  }

  return code;
}
