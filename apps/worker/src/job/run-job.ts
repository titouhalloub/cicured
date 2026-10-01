import {
  assertRunStatusTransition,
  failureKindForExitCode,
  runStatusForExitCode,
  type FailureKind,
  type RunStatus,
} from "@sft/schemas";
import { decryptInstallationId } from "../common/crypto";
import { registerSecret, unregisterSecret, type WorkerLogger } from "../common/secrets";
import type { WorkerEnv } from "../env";
import type { ExtractedReport } from "../report/handler";
import type { RunRepository } from "../run-repository";
import type { SandboxHandle, SandboxLauncher } from "../sandbox/launcher";

export interface ReportExtractionRequest {
  containerId: string;
  runId: string;
}

/** Narrow seam so the job can be tested without Docker. */
export type ReportExtractor = (
  request: ReportExtractionRequest,
) => Promise<ExtractedReport | null>;

export interface RunJobDeps {
  env: WorkerEnv;
  repository: RunRepository;
  sandbox: SandboxLauncher;
  extractReport: ReportExtractor;
  mintToken: (installationId: number) => Promise<string>;
  logger: WorkerLogger;
}

export interface RunJobResult {
  runId: string;
  status: RunStatus;
  exitCode: number | null;
  failureKind: FailureKind | null;
  reportPath?: string;
}

export type RunJob = (runId: string) => Promise<RunJobResult | null>;

interface Outcome {
  status: RunStatus;
  exitCode: number | null;
  failureKind: FailureKind | null;
  reportPath?: string;
}

/** Build minutes are billed, so a started run is at least one minute. */
function buildMinutes(startedAt: Date, finishedAt: Date): number {
  return Math.max(1, Math.ceil((finishedAt.getTime() - startedAt.getTime()) / 60_000));
}

/**
 * Maps the container outcome onto a run outcome (Spec §2 exit-code semantics):
 *
 *   timed out      -> timeout       (detected around the runner, no report parse)
 *   exit 0         -> success       (report parsed)
 *   exit 1         -> failed        (task failures - the normal outcome)
 *   exit 2 / other -> runner_crash  (never sent to the LLM)
 *
 * A missing or schema-invalid report is a `runner_crash` even on exit 0/1:
 * without the artifact there is nothing for the parser to consume, and the run
 * must not be reported as a plain task failure.
 */
async function resolveOutcome(
  deps: RunJobDeps,
  handle: SandboxHandle,
  runId: string,
): Promise<Outcome> {
  const result = await handle.waitFor(deps.env.SFT_DEADLINE_BUDGET_MS);
  if (result.timedOut) {
    return { status: "timeout", exitCode: null, failureKind: "timeout" };
  }

  const exitCode = result.exitCode;
  if (exitCode !== 0 && exitCode !== 1) {
    return { status: "runner_crash", exitCode, failureKind: "runner_crash" };
  }

  const extracted = await deps.extractReport({ containerId: handle.containerId, runId });
  if (!extracted) {
    return { status: "runner_crash", exitCode, failureKind: "runner_crash" };
  }
  return {
    status: runStatusForExitCode(exitCode),
    exitCode,
    failureKind: failureKindForExitCode(exitCode),
    reportPath: extracted.path,
  };
}

/**
 * The whole M2a execution path for one run: claim the row, mint an
 * installation token, run the sandbox, classify the outcome, persist it, and
 * always delete the container.
 *
 * The token exists as a local variable for the duration of the job: it is never
 * written to the run row, to a job payload or to a log line.
 */
export function createRunJob(deps: RunJobDeps): RunJob {
  return async function processRun(runId: string): Promise<RunJobResult | null> {
    const logger = deps.logger.child({ runId });

    const loaded = await deps.repository.loadRunWithProject(runId);
    if (!loaded) {
      logger.warn("run not found; dropping job");
      return null;
    }
    if (loaded.run.status !== "queued") {
      logger.warn(`run is ${loaded.run.status}, not queued; skipping (jobId dedupe)`);
      return null;
    }

    const startedAt = new Date();
    const claimed = await deps.repository.claimRun(runId, startedAt);
    if (!claimed) {
      logger.warn("run was claimed by another worker; skipping");
      return null;
    }

    let token: string | null = null;
    let handle: SandboxHandle | null = null;
    let finalized = false;

    try {
      const installationId = decryptInstallationId(
        deps.env.SFT_ENCRYPTION_KEY,
        loaded.project.installationIdEnc,
      );
      const minted = await deps.mintToken(installationId);
      token = minted;
      registerSecret(minted);
      logger.info(
        `launching sandbox image=${deps.env.SANDBOX_IMAGE} repo=${loaded.project.repoFullName} branch=${loaded.run.branch}`,
      );

      handle = await deps.sandbox.launch({
        runId,
        installationId,
        repoFullName: loaded.project.repoFullName,
        branch: loaded.run.branch,
        token: minted,
      });

      const outcome = await resolveOutcome(deps, handle, runId);
      assertRunStatusTransition("running", outcome.status);
      const finishedAt = new Date();
      await deps.repository.finalizeRun(runId, {
        status: outcome.status,
        exitCode: outcome.exitCode,
        failureKind: outcome.failureKind,
        finishedAt,
        buildMinutes: buildMinutes(startedAt, finishedAt),
      });
      finalized = true;
      logger.info(
        `run finished status=${outcome.status} exit=${outcome.exitCode ?? "none"} report=${outcome.reportPath ?? "none"}`,
      );
      return {
        runId,
        status: outcome.status,
        exitCode: outcome.exitCode,
        failureKind: outcome.failureKind,
        ...(outcome.reportPath ? { reportPath: outcome.reportPath } : {}),
      };
    } catch (error) {
      if (!finalized) {
        await markRunnerCrash(deps, runId, startedAt);
      }
      logger.error("run failed before completion", error);
      throw error;
    } finally {
      if (handle) {
        try {
          await handle.remove();
        } catch (error) {
          logger.error("could not remove the sandbox container", error);
        }
      }
      if (token) unregisterSecret(token);
    }
  };
}

/** Best-effort operational stamp; never masks the original failure. */
async function markRunnerCrash(
  deps: RunJobDeps,
  runId: string,
  startedAt: Date,
): Promise<void> {
  const finishedAt = new Date();
  try {
    await deps.repository.finalizeRun(runId, {
      status: "runner_crash",
      exitCode: null,
      failureKind: "runner_crash",
      finishedAt,
      buildMinutes: buildMinutes(startedAt, finishedAt),
    });
  } catch (error) {
    deps.logger.child({ runId }).error("could not persist runner_crash", error);
  }
}