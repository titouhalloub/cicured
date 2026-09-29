import { execFile, type ExecFileException } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path of the pinned runner under test. */
export const RUNNER_PATH = fileURLToPath(new URL("../sft-dev.mjs", import.meta.url));

export interface RunnerTaskResult {
  name: string;
  command: string;
  success: boolean;
  exitCode: number | null;
  timedOut: boolean;
  skipped: boolean;
  truncated: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface RunnerReport {
  tool: string;
  version: number;
  finishedAt: string;
  runnerError: string | null;
  warnings: string[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    totalDurationMs: number;
  };
  tasks: RunnerTaskResult[];
}

export interface WorkspaceSetup {
  /** JSON value written to `sft-dev.config.json` (skipped when undefined). */
  config?: unknown;
  /** Raw `sft-dev.config.json` content; takes precedence over `config`. */
  configRaw?: string;
  /** JSON value written to `package.json` (skipped when undefined). */
  packageJson?: unknown;
  /** Writes an empty `tsconfig.json` to trigger auto-detection. */
  tsconfig?: boolean;
  /** Extra files to create, keyed by file name (e.g. task scripts). */
  scripts?: Record<string, string>;
  /** Creates a *directory* named `sft-report.json` to force the exit-2 path. */
  blockReportWrite?: boolean;
}

export interface RunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  report: RunnerReport | null;
}

/**
 * Runs the pinned runner in a throwaway workspace and captures everything.
 * Inherited `SFT_*` variables are stripped so host config cannot leak in.
 */
export async function runRunner(
  setup: WorkspaceSetup,
  env: Record<string, string> = {},
): Promise<RunOutcome> {
  const dir = mkdtempSync(path.join(tmpdir(), "sft-runner-"));
  try {
    if (setup.tsconfig) {
      writeFileSync(path.join(dir, "tsconfig.json"), "{}\n");
    }
    if (setup.packageJson !== undefined) {
      writeFileSync(path.join(dir, "package.json"), JSON.stringify(setup.packageJson, null, 2));
    }
    if (setup.configRaw !== undefined) {
      writeFileSync(path.join(dir, "sft-dev.config.json"), setup.configRaw);
    } else if (setup.config !== undefined) {
      writeFileSync(path.join(dir, "sft-dev.config.json"), JSON.stringify(setup.config, null, 2));
    }
    for (const [name, source] of Object.entries(setup.scripts ?? {})) {
      writeFileSync(path.join(dir, name), source);
    }
    if (setup.blockReportWrite) {
      mkdirSync(path.join(dir, "sft-report.json"));
    }

    return await execRunner(dir, env);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // A killed task process may briefly hold the workspace on Windows; temp
      // leftovers are harmless.
    }
  }
}

function execRunner(cwd: string, overrides: Record<string, string>): Promise<RunOutcome> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [RUNNER_PATH],
      {
        cwd,
        env: sanitizedEnv(overrides),
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
      (error: ExecFileException | null, stdout, stderr) => {
        resolve({
          exitCode: exitCodeFrom(error),
          stdout,
          stderr,
          report: readReport(cwd),
        });
      },
    );
  });
}

function sanitizedEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("SFT_")) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

function exitCodeFrom(error: ExecFileException | null): number {
  if (!error) return 0;
  return typeof error.code === "number" ? error.code : 1;
}

function readReport(cwd: string): RunnerReport | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(cwd, "sft-report.json"), "utf8"));
    return parsed as RunnerReport;
  } catch {
    return null;
  }
}
