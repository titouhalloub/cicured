import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RUNNER_PATH, runRunner, type RunOutcome, type RunnerReport } from "./helpers";

/**
 * Pinned artifact hash (Spec §2). If the runner is intentionally upgraded,
 * replace sft-dev.mjs byte-for-byte and update this constant plus any
 * behaviour tests - see packages/runner/README.md.
 */
const PINNED_SHA256 = "855dca94d5ad974eebcc3690f49883eb14b913ec74f1c466d3eb4227e3420961";

const OK_SCRIPT = "process.exit(0);\n";
const FAIL_SCRIPT = "process.exit(3);\n";
const SLEEP_SCRIPT = "setTimeout(() => process.exit(0), Number(process.argv[2] ?? 3000));\n";
const ENV_PROBE_SCRIPT = [
  "console.log(",
  "  JSON.stringify({",
  '    marker: "SFT-ENV-PROBE",',
  "    githubToken: process.env.GITHUB_TOKEN ?? null,",
  "    ghToken: process.env.GH_TOKEN ?? null,",
  "    gitAskPass: process.env.GIT_ASKPASS ?? null,",
  "  }),",
  ");",
  "",
].join("\n");

function requireReport(outcome: RunOutcome): RunnerReport {
  if (!outcome.report) {
    throw new Error(`runner produced no report (exit ${outcome.exitCode})`);
  }
  return outcome.report;
}

describe("pinned runner artifact", () => {
  it("is byte-identical to the provided sft-dev.mjs", () => {
    const hash = createHash("sha256").update(readFileSync(RUNNER_PATH)).digest("hex");
    expect(hash).toBe(PINNED_SHA256);
  });
});

describe("exit codes (Spec §2)", () => {
  it("exits 0 when every task passes and keeps the v2 report additive fields", async () => {
    const outcome = await runRunner({
      scripts: { "ok.js": OK_SCRIPT },
      config: {
        tasks: [
          { name: "Type Check", command: "node ok.js" },
          { name: "Tests", command: "node ok.js" },
        ],
      },
    });

    expect(outcome.exitCode).toBe(0);
    const report = requireReport(outcome);
    expect(report.tool).toBe("sft-dev");
    expect(report.version).toBe(2);
    expect(report.runnerError).toBeNull();
    expect(report.warnings).toEqual([]);
    expect(report.summary).toMatchObject({ total: 2, passed: 2, failed: 0, skipped: 0 });
    expect(report.summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(report.tasks).toHaveLength(2);
    expect(report.tasks[0]).toMatchObject({
      name: "Type Check",
      success: true,
      exitCode: 0,
      timedOut: false,
      skipped: false,
      truncated: false,
    });
  });

  it("exits 1 on task failures and preserves the task exit code", async () => {
    const outcome = await runRunner({
      scripts: { "fail3.js": FAIL_SCRIPT, "ok.js": OK_SCRIPT },
      config: {
        tasks: [
          { name: "Lint", command: "node fail3.js" },
          { name: "Tests", command: "node ok.js" },
        ],
      },
    });

    expect(outcome.exitCode).toBe(1);
    const report = requireReport(outcome);
    expect(report.summary).toMatchObject({ total: 2, passed: 1, failed: 1, skipped: 0 });
    expect(report.tasks[0]).toMatchObject({ name: "Lint", success: false, exitCode: 3 });
    expect(report.tasks[1]).toMatchObject({ name: "Tests", success: true, exitCode: 0 });
  });

  it("exits 2 when the report cannot be written (runner crash, never exit 1)", async () => {
    const outcome = await runRunner({
      scripts: { "ok.js": OK_SCRIPT },
      config: { tasks: [{ name: "Type Check", command: "node ok.js" }] },
      blockReportWrite: true,
    });

    expect(outcome.exitCode).toBe(2);
    expect(outcome.report).toBeNull();
    expect(outcome.stderr).toContain("could not write report");
  });
});

describe("timeouts and global deadline (Spec §2)", () => {
  it("kills an overrunning task at SFT_TASK_TIMEOUT_MS and reports exit code 124", async () => {
    const outcome = await runRunner(
      {
        scripts: { "sleep.js": SLEEP_SCRIPT },
        config: { tasks: [{ name: "Tests", command: "node sleep.js 1500" }] },
      },
      { SFT_TASK_TIMEOUT_MS: "500" },
    );

    expect(outcome.exitCode).toBe(1);
    const report = requireReport(outcome);
    const task = report.tasks[0];
    expect(task).toBeDefined();
    expect(task).toMatchObject({
      name: "Tests",
      success: false,
      timedOut: true,
      exitCode: 124,
      skipped: false,
    });
    expect(task?.durationMs).toBeGreaterThanOrEqual(400);
    expect(report.summary.failed).toBe(1);
  });

  it("skips remaining tasks once SFT_DEADLINE_MS is exhausted and exits 1", async () => {
    const outcome = await runRunner(
      {
        scripts: { "sleep.js": SLEEP_SCRIPT, "ok.js": OK_SCRIPT },
        config: {
          tasks: [
            { name: "Build", command: "node sleep.js 1500" },
            { name: "Tests", command: "node ok.js" },
          ],
        },
      },
      { SFT_DEADLINE_MS: "900", SFT_TASK_TIMEOUT_MS: "600000" },
    );

    expect(outcome.exitCode).toBe(1);
    const report = requireReport(outcome);
    expect(report.tasks[0]).toMatchObject({ name: "Build", timedOut: true, exitCode: 124 });
    expect(report.tasks[1]).toMatchObject({
      name: "Tests",
      skipped: true,
      success: false,
      exitCode: null,
      durationMs: 0,
      stdout: "",
    });
    expect(report.tasks[1]?.stderr).toContain("global deadline exceeded");
    expect(report.summary).toMatchObject({ total: 2, passed: 0, failed: 1, skipped: 1 });
  });
});

describe("sft-dev.config.json handling", () => {
  it("ignores invalid entries with a warning and runs the valid ones", async () => {
    const outcome = await runRunner({
      scripts: { "ok.js": OK_SCRIPT },
      config: {
        tasks: [
          { name: "Type Check", command: "node ok.js" },
          { name: "Missing command" },
          { name: "Blank command", command: "   " },
          "not-a-task",
        ],
      },
    });

    expect(outcome.exitCode).toBe(0);
    const report = requireReport(outcome);
    expect(report.tasks).toHaveLength(1);
    expect(report.tasks[0]?.name).toBe("Type Check");
    expect(report.warnings).toEqual(["sft-dev.config.json: 3 invalid task(s) ignored"]);
  });

  it("falls back to auto-detection when no configured task is valid", async () => {
    const outcome = await runRunner({
      packageJson: {
        name: "fixture",
        version: "1.0.0",
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      },
      config: { tasks: [{ name: "Missing command" }, null] },
    });

    expect(outcome.exitCode).toBe(0);
    const report = requireReport(outcome);
    expect(report.tasks).toHaveLength(0);
    expect(report.warnings).toContain("sft-dev.config.json: 2 invalid task(s) ignored");
    expect(report.warnings).toContain(
      "sft-dev.config.json: no valid tasks, falling back to auto-detection",
    );
    expect(report.warnings).toContain(
      "no tasks detected (no tsconfig, eslint config, build/test script)",
    );
  });

  it("lets sft-dev.config.json override auto-detection", async () => {
    const outcome = await runRunner({
      tsconfig: true,
      scripts: { "ok.js": OK_SCRIPT },
      config: { tasks: [{ name: "Only task", command: "node ok.js" }] },
    });

    expect(outcome.exitCode).toBe(0);
    const report = requireReport(outcome);
    expect(report.tasks.map((task) => task.name)).toEqual(["Only task"]);
    expect(report.warnings).toEqual([]);
  });

  it("warns about malformed config JSON instead of crashing", async () => {
    const outcome = await runRunner({ configRaw: "{ not json" });

    expect(outcome.exitCode).toBe(0);
    const report = requireReport(outcome);
    expect(report.warnings[0]).toContain("sft-dev.config.json invalid:");
  });
});

describe("token scrubbing (Spec §2 / §8)", () => {
  it("removes git provider tokens before user scripts execute", async () => {
    const secret = "ghp_supersecret_token_value_1234567890";
    const outcome = await runRunner(
      {
        scripts: { "probe.js": ENV_PROBE_SCRIPT },
        config: { tasks: [{ name: "Probe", command: "node probe.js" }] },
      },
      {
        GITHUB_TOKEN: secret,
        GH_TOKEN: secret,
        GIT_ASKPASS: secret,
        SFT_UNRELATED: "kept",
      },
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).not.toContain(secret);
    expect(outcome.stderr).not.toContain(secret);

    const report = requireReport(outcome);
    const stdout = report.tasks[0]?.stdout ?? "";
    expect(stdout).toContain("SFT-ENV-PROBE");
    expect(stdout).toContain('"githubToken":null');
    expect(stdout).toContain('"ghToken":null');
    expect(stdout).toContain('"gitAskPass":null');
  });

  it("strips tokens before auto-detected tasks too (npm test path)", async () => {
    const secret = "glpat_supersecret_value_0987654321";
    const outcome = await runRunner(
      {
        packageJson: {
          name: "fixture",
          version: "1.0.0",
          scripts: { test: "node probe.js" },
        },
        scripts: { "probe.js": ENV_PROBE_SCRIPT },
      },
      { GITLAB_TOKEN: secret, GL_TOKEN: secret },
    );

    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).not.toContain(secret);
    const report = requireReport(outcome);
    expect(report.tasks.map((task) => task.name)).toEqual(["Tests"]);
    expect(report.tasks[0]?.stdout).toContain('"githubToken":null');
  });
});


