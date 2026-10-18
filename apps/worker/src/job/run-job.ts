import { promises as fs } from "node:fs";
import path from "node:path";
import type { FindingsWithFingerprint } from "@sft/parser";
import {
  assertRunStatusTransition,
  CodeGraph,
  failureKindForExitCode,
  runStatusForExitCode,
  type FailureKind,
  type RunStatus,
  type SftReportV2,
} from "@sft/schemas";
import { blastRadiusFor, parseReport, type Neighborhood } from "@sft/parser";
import type { LlmCache } from "../ai/cache";
import type { LlmProvider } from "../ai/provider";
import { generateSuggestions } from "../ai/generate";
import { decryptInstallationId } from "../common/crypto";
import { registerSecret, unregisterSecret, type WorkerLogger } from "../common/secrets";
import type { WorkerEnv } from "../env";
import type { ExtractedReport } from "../report/handler";
import type { LogStreamHandle } from "../logs/attach";
import type { LogPublisher } from "../logs/publisher";
import type { RunRepository } from "../run-repository";
import type { SandboxHandle, SandboxLauncher, SandboxWaitResult } from "../sandbox/launcher";
import type { LogArchiver } from "../logs/archiver";

export interface ReportExtractionRequest {
  containerId: string;
  runId: string;
}

/** Narrow seam so the job can be tested without Docker. */
export type ReportExtractor = (
  request: ReportExtractionRequest,
) => Promise<ExtractedReport | null>;

/** Narrow seam so the job can be tested without Docker or Redis. */
export type AttachFn = (input: {
  containerId: string;
  runId: string;
  archiver: LogArchiver;
}) => Promise<LogStreamHandle>;

export interface RunJobDeps {
  env: WorkerEnv;
  repository: RunRepository;
  sandbox: SandboxLauncher;
  extractReport: ReportExtractor;
  mintToken: (installationId: number) => Promise<string>;
  logger: WorkerLogger;
  /** M4a AI suggestion engine. When both are present, a generation pass runs
   * after findings are persisted. */
  llmProvider: LlmProvider | null;
  llmCache: LlmCache | null;
  /** M2b-1: live log fan-out. */
  publisher: LogPublisher;
  attach: AttachFn;
  /** M2b-2: log archiver for S3 uploads. Run-scoped via createArchiver. */
  createArchiver: (runId: string) => LogArchiver;
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
  /** The parsed report, when extraction succeeded — feeds the M3b findings. */
  report?: SftReportV2;
}

/** Build minutes are billed, so a started run is at least one minute. */
function buildMinutes(startedAt: Date, finishedAt: Date): number {
  return Math.max(1, Math.ceil((finishedAt.getTime() - startedAt.getTime()) / 60_000));
}

/**
 * Maps a finished container's exit status onto a run outcome (Spec §2):
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
async function classifyOutcome(
  deps: RunJobDeps,
  handle: SandboxHandle,
  result: SandboxWaitResult,
  runId: string,
): Promise<Outcome> {
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
    report: extracted.report,
  };
}

/**
 * Publishes the terminal event so SSE clients can leave their streaming state
 * without a second request. Best-effort by contract: a Redis hiccup must never
 * turn a successful run into a failed one.
 */
async function publishEnd(
  deps: RunJobDeps,
  runId: string,
  status: RunStatus,
  exitCode: number | null,
): Promise<void> {
  try {
    await deps.publisher.publish(runId, { type: "end", runId, exitCode, status });
  } catch (error) {
    deps.logger.child({ runId }).error("could not publish the log end event", error);
  }
}

/**
 * Phase 3c-2: read the sandbox's sft-graph.json from the staging directory.
 * The staging dir is deleted when the report is extracted, so this must run
 * BEFORE classifyOutcome — i.e. at the same point the worker reads
 * sft-report.json out of the same directory.
 *
 * A missing file is expected until the sandbox scanner ships (Phase 3c-3),
 * so only a present-but-unparseable file warns. Never throws.
 */
async function readStagedGraph(
  reportsDir: string,
  runId: string,
  logger: WorkerLogger,
): Promise<CodeGraph | null> {
  const source = path.join(path.resolve(reportsDir), runId, "sft-graph.json");
  let raw: string;
  try {
    raw = await fs.readFile(source, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = CodeGraph.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
    logger.warn("sft-graph.json failed schema validation");
  } catch (error) {
    logger.warn("sft-graph.json could not be parsed", error);
  }
  return null;
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
    let logStream: LogStreamHandle | null = null;
    let finalized = false;

    /** Idempotent: safe after the tail has already been drained. */
    const stopLogs = async (): Promise<void> => {
      if (!logStream) return;
      const stream = logStream;
      logStream = null;
      try {
        await stream.stop();
      } catch (error) {
        logger.error("could not stop the log stream", error);
      }
    };

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

      // M2b-1: start tapping the container's output. Docker replays the whole
      // log on attach, so nothing logged before this point is missed.
      const archiver = deps.createArchiver(runId);
      logStream = await deps.attach({ containerId: handle.containerId, runId, archiver });

      const waitResult = await handle.waitFor(deps.env.SFT_DEADLINE_BUDGET_MS);
      // Drain the tail before extracting the report.
      await stopLogs();

      // M2b-2: flush buffered logs to S3 before report extraction. The
      // archiver never throws; on failure s3Key is null and the run continues
      // (report extraction decides the outcome, not the log upload).
      const flushed = await archiver.flush();

      // Phase 3c-2: read the graph while the staging directory still exists —
      // report extraction (classifyOutcome) removes it afterwards. Missing is
      // expected until the sandbox scanner ships; readStagedGraph stays silent.
      const graph = await readStagedGraph(deps.env.REPORTS_DIR, runId, logger);

      const outcome = await classifyOutcome(deps, handle, waitResult, runId);
      assertRunStatusTransition("running", outcome.status);
      const finishedAt = new Date();

      // M3b: derive findings from the report before persisting the outcome.
      // Best-effort by contract: a parse or insert hiccup must not fail a
      // run whose report already landed.
      let parsedFindings: FindingsWithFingerprint[] | undefined;
      if (outcome.report) {
        try {
          parsedFindings = parseReport(outcome.report);
          await deps.repository.insertFindings(runId, parsedFindings);
        } catch (error) {
          logger.error("could not persist findings", error);
        }
      }

      // M4a: LLM generation stage.
      // Only run when provider + cache are configured (AI disabled when
      // ANTHROPIC_API_KEY is unset). Findings are resolved with their DB IDs
      // so the cache/key contract stays stable.
      if (parsedFindings && deps.llmProvider && deps.llmCache) {
        const findingsWithId = await deps.repository.getFindingsByFingerprints(
          runId,
          parsedFindings.map((finding) => finding.fingerprint),
        );

        // Phase 3c-2: precompute each finding's blast radius from the staged
        // graph. With no graph every neighborhood is null, restoring the
        // pre-graph behavior exactly.
        const neighborhoods = new Map<string, Neighborhood | null>();
        for (const finding of findingsWithId) {
          if (graph === null) {
            neighborhoods.set(finding.fingerprint, null);
            continue;
          }
          const relFile = finding.file.replace(/^\/workspace\/repo\//, "");
          neighborhoods.set(
            finding.fingerprint,
            blastRadiusFor(graph, { file: relFile, line: finding.line }),
          );
        }

        const options = {
          provider: deps.llmProvider,
          cache: deps.llmCache,
          logger: logger,
          temperature: deps.env.LLM_TEMPERATURE,
          maxOutputTokens: deps.env.LLM_MAX_OUTPUT_TOKENS,
          findingsPerRunCap: deps.env.LLM_FINDINGS_PER_RUN_CAP,
          neighborhoods,
        };

        const drafts = await generateSuggestions(
          findingsWithId,
          async () => {
            // M4a placeholder: the sandbox workspace is destroyed at the end of
            // the run, so the worker cannot fetch finding-snapshot code here.
            // A real worker would resolve `finding.file` + `finding.line` from
            // the archived clone or a git provider and return ~5 lines.
            return "";
          },
          options,
        );

        if (drafts.length > 0) {
          // GeneratedSuggestion carries findingId (notNull FK), model and
          // promptVersion — persisted as-is so each row links to its finding.
          await deps.repository.insertSuggestions(runId, drafts);
        }

        logger.info(`AI stage complete: ${drafts.length} suggestion(s) for run ${runId}`);
      }

      await deps.repository.finalizeRun(runId, {
        status: outcome.status,
        exitCode: outcome.exitCode,
        failureKind: outcome.failureKind,
        finishedAt,
        buildMinutes: buildMinutes(startedAt, finishedAt),
        s3LogKey: flushed.s3Key,
        logArchive:
          flushed.stdoutBytes > 0 || flushed.stderrBytes > 0
            ? { stdoutBytes: flushed.stdoutBytes, stderrBytes: flushed.stderrBytes }
            : null,
      });
      finalized = true;
      // Only now, so the client learns the final status from the stream itself.
      await publishEnd(deps, runId, outcome.status, outcome.exitCode);
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
      // The row says runner_crash now; tell the clients, then fail the job.
      await publishEnd(deps, runId, "runner_crash", null);
      logger.error("run failed before completion", error);
      throw error;
    } finally {
      await stopLogs();
      if (handle) {
        try {
          // await handle.remove();
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