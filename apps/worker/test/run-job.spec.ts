import { createCipheriv, randomBytes } from "node:crypto";
import type { FindingsWithFingerprint } from "@sft/parser";
import { describe, expect, it, vi } from "vitest";
import type {
  FinalizeRunInput,
  RunRepository,
  RunWithProject,
} from "../src/run-repository";
import { createRunJob, type RunJobDeps } from "../src/job/run-job";
import type {
  SandboxHandle,
  SandboxLauncher,
  SandboxWaitResult,
} from "../src/sandbox/launcher";
import type { ExtractedReport } from "../src/report/handler";
import type { FlushResult, LogArchiver } from "../src/logs/archiver";
import type { LlmProvider } from "../src/ai/provider";
import type { LlmCache } from "../src/ai/cache";
import { createLogger } from "../src/common/secrets";
import { makeEnv, TEST_ENCRYPTION_KEY } from "./test-utils";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "ghs_supersecrettokenvalue0123456789";

/** Encrypts an installation id exactly like apps/api's CryptoService does. */
function encryptInstallationId(plaintext: string): string {
  const key = Buffer.from(TEST_ENCRYPTION_KEY, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

function makeRun(status: RunWithProject["run"]["status"] = "queued"): RunWithProject {
  return {
    run: {
      id: RUN_ID,
      projectId: "22222222-2222-4222-8222-222222222222",
      branch: "main",
      trigger: "manual",
      status,
      exitCode: null,
      failureKind: null,
      createdAt: new Date("2026-09-30T12:00:00.000Z"),
      startedAt: null,
      finishedAt: null,
      buildMinutes: null,
      s3_log_key: null,
    },
    project: {
      id: "22222222-2222-4222-8222-222222222222",
      repoFullName: "acme/web",
      installationIdEnc: encryptInstallationId("4242"),
      defaultBranch: "main",
    },
  };
}

const REPORT: ExtractedReport = {
  path: "/reports/sft-report.json",
  report: {
    tool: "sft-dev",
    version: 2,
    finishedAt: "2026-09-30T12:00:00.000Z",
    runnerError: null,
    warnings: [],
    summary: { total: 1, passed: 1, failed: 0, skipped: 0, totalDurationMs: 1 },
    tasks: [],
  },
};
/** Builds deps whose only real logic is the exit-code mapping under test. */
function makeDeps(options: {
  wait: SandboxWaitResult;
  report?: ExtractedReport | null;
  status?: RunWithProject["run"]["status"];
  claimRun?: boolean;
}) {
  const calls = {
    finalized: [] as FinalizeRunInput[],
    launched: [] as unknown[],
    extractCount: 0,
    mintedWith: [] as number[],
    attached: [] as Array<{ containerId: string; runId: string }>,
    stops: 0,
    published: [] as unknown[],
    insertedFindings: [] as FindingsWithFingerprint[][],
    flushes: 0,
    flushedFor: [] as string[],
    flushResult: { s3Key: "logs/test-run", stdoutBytes: 100, stderrBytes: 50 } as FlushResult,
  };

  const handle: SandboxHandle = {
    containerId: "container-1",
    waitFor: vi.fn(async () => options.wait),
    remove: vi.fn(async () => undefined),
  };

  const repository: RunRepository = {
    loadRunWithProject: async () => makeRun(options.status ?? "queued"),
    claimRun: async () => options.claimRun ?? true,
    finalizeRun: async (_runId, input) => {
      calls.finalized.push(input);
    },
    insertFindings: async (_runId, findings) => {
      calls.insertedFindings.push(findings);
    },
    getFindingsByFingerprints: async () => [],
    insertSuggestions: async () => undefined,
  };

  const sandbox: SandboxLauncher = {
    launch: async (input) => {
      calls.launched.push(input);
      return handle;
    },
    killAll: async () => undefined,
  };

  const deps: RunJobDeps = {
    env: makeEnv(),
    repository,
    sandbox,
    extractReport: async () => {
      calls.extractCount += 1;
      return options.report === undefined ? REPORT : options.report;
    },
    mintToken: async (installationId) => {
      calls.mintedWith.push(installationId);
      return TOKEN;
    },
    logger: createLogger("run-job-test"),
    publisher: {
      publish: async (_runId, event) => {
        calls.published.push(event);
      },
      close: async () => undefined,
    },
    createArchiver: (runId: string): LogArchiver => {
      calls.flushedFor.push(runId);
      return {
        append: () => undefined,
        flush: async () => {
          calls.flushes += 1;
          return calls.flushResult;
        },
      };
    },
    attach: async (input) => {
      calls.attached.push({ containerId: input.containerId, runId: input.runId });
      return {
        stop: async () => {
          calls.stops += 1;
        },
      };
    },
    llmProvider: null as LlmProvider | null,
    llmCache: null as LlmCache | null,
  };

  return { deps, calls, handle };
}

describe("run job exit-code matrix (Spec §2)", () => {
  it("exit 0 -> success with the report stored", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 0, timedOut: false } });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({
      runId: RUN_ID,
      status: "success",
      exitCode: 0,
      failureKind: null,
      reportPath: REPORT.path,
    });
    expect(calls.finalized).toHaveLength(1);
    expect(calls.finalized[0]).toMatchObject({
      status: "success",
      exitCode: 0,
      failureKind: null,
    });
    expect(calls.finalized[0]!.finishedAt).toBeInstanceOf(Date);
    expect(calls.finalized[0]!.buildMinutes).toBeGreaterThanOrEqual(1);
    expect(calls.extractCount).toBe(1);
  });

  it("exit 1 -> failed with failure_kind task_failure", async () => {
    const { deps } = makeDeps({ wait: { exitCode: 1, timedOut: false } });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({
      status: "failed",
      exitCode: 1,
      failureKind: "task_failure",
    });
  });

  it("exit 2 -> runner_crash and never parses the report", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 2, timedOut: false } });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({
      status: "runner_crash",
      exitCode: 2,
      failureKind: "runner_crash",
    });
    // Exit 2 is an operational alert, never sent to the LLM (Spec §2).
    expect(calls.extractCount).toBe(0);
  });

  it("an unexpected exit code is treated as runner_crash", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 137, timedOut: false } });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({ status: "runner_crash", failureKind: "runner_crash" });
    expect(calls.extractCount).toBe(0);
  });

  it("timeout -> status=timeout, failure_kind=timeout, no report parse", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: null, timedOut: true } });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({
      status: "timeout",
      exitCode: null,
      failureKind: "timeout",
    });
    expect(calls.extractCount).toBe(0);
    // A SIGKILL exit code is not a runner exit code, so none is persisted.
    expect(calls.finalized[0]!.exitCode).toBeNull();
  });

  it("exit 0 with a missing report is a runner_crash, not a success", async () => {
    const { deps } = makeDeps({ wait: { exitCode: 0, timedOut: false }, report: null });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({ status: "runner_crash", failureKind: "runner_crash" });
  });

  it("claims the run before launching and always removes the container", async () => {
    const { deps, calls, handle } = makeDeps({ wait: { exitCode: 1, timedOut: false } });

    await createRunJob(deps)(RUN_ID);

    expect(calls.launched).toHaveLength(1);
    expect(handle.remove).toHaveBeenCalledTimes(1);
  });

  it("removes the container even when the report extraction throws", async () => {
    const { deps, calls, handle } = makeDeps({ wait: { exitCode: 0, timedOut: false } });
    deps.extractReport = async () => {
      throw new Error("docker daemon went away");
    };

    await expect(createRunJob(deps)(RUN_ID)).rejects.toThrow("docker daemon went away");
    expect(handle.remove).toHaveBeenCalledTimes(1);
    // The row is still stamped so no run is left stuck in `running`.
    expect(calls.finalized.at(-1)).toMatchObject({
      status: "runner_crash",
      failureKind: "runner_crash",
    });
  });

  it("mints the token for the decrypted installation id and never persists it", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 0, timedOut: false } });

    await createRunJob(deps)(RUN_ID);

    expect(calls.mintedWith).toEqual([4242]);
    // The token reaches the sandbox as GIT_TOKEN and nothing else.
    expect(calls.launched[0]).toMatchObject({ token: TOKEN, branch: "main" });
    expect(JSON.stringify(calls.finalized)).not.toContain(TOKEN);
  });

  it("skips a run that is not queued (jobId dedupe / redelivery)", async () => {
    const { deps, calls } = makeDeps({
      wait: { exitCode: 0, timedOut: false },
      status: "running",
    });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toBeNull();
    expect(calls.launched).toHaveLength(0);
    expect(calls.finalized).toHaveLength(0);
  });

  it("skips when another worker already claimed the run", async () => {
    const { deps, calls } = makeDeps({
      wait: { exitCode: 0, timedOut: false },
      claimRun: false,
    });

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toBeNull();
    expect(calls.launched).toHaveLength(0);
  });

  it("streams logs: attaches, stops before extraction, then publishes the end event", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 1, timedOut: false } });

    await createRunJob(deps)(RUN_ID);

    expect(calls.attached).toEqual([{ containerId: "container-1", runId: RUN_ID }]);
    expect(calls.stops).toBe(1);
    // The end event carries the final status so a client needs no 2nd request.
    expect(calls.published).toEqual([
      { type: "end", runId: RUN_ID, exitCode: 1, status: "failed" },
    ]);
  });

  it("publishes an end event even when the run blows up", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 0, timedOut: false } });
    deps.mintToken = async () => {
      throw new Error("GitHub is down");
    };

    await expect(createRunJob(deps)(RUN_ID)).rejects.toThrow("GitHub is down");
    expect(calls.published).toEqual([
      { type: "end", runId: RUN_ID, exitCode: null, status: "runner_crash" },
    ]);
  });

  it("does not fail the run when publishing the end event fails", async () => {
    const { deps } = makeDeps({ wait: { exitCode: 1, timedOut: false } });
    deps.publisher = {
      publish: async () => {
        throw new Error("redis down");
      },
      close: async () => undefined,
    };

    const result = await createRunJob(deps)(RUN_ID);
    expect(result).toMatchObject({ status: "failed", exitCode: 1 });
  });

  it("flushes archived logs before extracting the report and stamps s3LogKey", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 0, timedOut: false } });
    const order: string[] = [];
    const originalExtract = deps.extractReport;
    deps.extractReport = async (request) => {
      order.push("extract");
      return originalExtract(request);
    };
    const originalCreateArchiver = deps.createArchiver;
    deps.createArchiver = (runId) => {
      const archiver = originalCreateArchiver(runId);
      const originalFlush = archiver.flush.bind(archiver);
      return {
        append: archiver.append.bind(archiver),
        flush: async () => {
          order.push("flush");
          return originalFlush();
        },
      };
    };

    await createRunJob(deps)(RUN_ID);

    expect(order).toEqual(["flush", "extract"]);
    expect(calls.flushedFor).toEqual([RUN_ID]);
    expect(calls.finalized.at(-1)).toMatchObject({
      status: "success",
      s3LogKey: "logs/test-run",
      logArchive: { stdoutBytes: 100, stderrBytes: 50 },
    });
  });

  it("does not fail the run when the S3 flush fails (null key, no archive rows)", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 0, timedOut: false } });
    calls.flushResult = { s3Key: null, stdoutBytes: 0, stderrBytes: 0 };

    const result = await createRunJob(deps)(RUN_ID);

    expect(result).toMatchObject({ status: "success", exitCode: 0 });
    expect(calls.finalized.at(-1)).toMatchObject({ s3LogKey: null, logArchive: null });
  });

  it("persists findings after report extraction", async () => {
    const { deps, calls } = makeDeps({
      wait: { exitCode: 1, timedOut: false },
      report: {
        path: "/reports/sft-report.json",
        report: {
          tool: "sft-dev",
          version: 2,
          finishedAt: "2026-09-30T12:00:00.000Z",
          runnerError: null,
          warnings: [],
          summary: {
            total: 1,
            passed: 0,
            failed: 1,
            skipped: 0,
            totalDurationMs: 10,
          },
          tasks: [
            {
              name: "Type Check",
              command: "pnpm -r typecheck",
              success: false,
              exitCode: 2,
              timedOut: false,
              skipped: false,
              truncated: false,
              durationMs: 10,
              stdout: "src/x.ts(3,7): error TS2304: Cannot find name 'bar'.\n",
              stderr: "",
            },
          ],
        },
      },
    });

    await createRunJob(deps)(RUN_ID);

    expect(calls.insertedFindings).toHaveLength(1);
    const findings = calls.insertedFindings[0];
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      category: "typecheck",
      ruleId: "TS2304",
      file: "src/x.ts",
      line: 3,
      col: 7,
      message: "Cannot find name 'bar'.",
    });
    expect(findings[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not fail the run when insertFindings throws", async () => {
    const { deps, calls } = makeDeps({ wait: { exitCode: 0, timedOut: false } });
    deps.repository.insertFindings = async () => {
      throw new Error("insert exploded");
    };

    const result = await createRunJob(deps)(RUN_ID);

    // The report already landed; the run keeps its real status.
    expect(result).toMatchObject({ status: "success", exitCode: 0 });
    expect(calls.finalized).toHaveLength(1);
    expect(calls.finalized[0]).toMatchObject({ status: "success" });
  });
});