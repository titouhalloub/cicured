import { z } from "zod";

/** Spec §5 — run status enum (includes `runner_crash` so exit-2 is distinguishable). */
export const RUN_STATUSES = [
  "queued",
  "running",
  "success",
  "failed",
  "runner_crash",
  "timeout",
  "cancelled",
] as const;

export const RunStatus = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatus>;

/** Spec §5 — nullable failure classification persisted next to `exit_code`. */
export const FAILURE_KINDS = [
  "task_failure",
  "runner_crash",
  "timeout",
  "cancelled",
  "oom",
] as const;

export const FailureKind = z.enum(FAILURE_KINDS);
export type FailureKind = z.infer<typeof FailureKind>;

/** Spec §5 — how a run was triggered. */
export const RUN_TRIGGERS = ["push", "manual", "pr"] as const;
export const RunTrigger = z.enum(RUN_TRIGGERS);
export type RunTrigger = z.infer<typeof RunTrigger>;

/**
 * Legal run status transitions. `failed` covers exit 1 including deadline-skips;
 * `timeout` is set by the worker on wall-clock kill; terminal statuses are final.
 */
export const RUN_STATUS_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["running", "cancelled"],
  running: ["success", "failed", "runner_crash", "timeout", "cancelled"],
  success: [],
  failed: [],
  runner_crash: [],
  timeout: [],
  cancelled: [],
};

export class RunStatusTransitionError extends Error {
  constructor(
    readonly from: RunStatus,
    readonly to: RunStatus,
  ) {
    super(`illegal run status transition: ${from} -> ${to}`);
    this.name = "RunStatusTransitionError";
  }
}

/** Re-applying the current status is allowed (idempotent worker writes). */
export function canTransitionRunStatus(from: RunStatus, to: RunStatus): boolean {
  return from === to || RUN_STATUS_TRANSITIONS[from].includes(to);
}

export function assertRunStatusTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransitionRunStatus(from, to)) {
    throw new RunStatusTransitionError(from, to);
  }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return RUN_STATUS_TRANSITIONS[status].length === 0;
}

/**
 * Runner exit-code semantics (Spec §2). `timeout`/`oom` are detected by the
 * worker around the runner, never inferred from an exit code.
 */
export function runStatusForExitCode(exitCode: number): RunStatus {
  if (exitCode === 0) return "success";
  if (exitCode === 2) return "runner_crash";
  return "failed";
}

export function failureKindForExitCode(exitCode: number): FailureKind | null {
  if (exitCode === 0) return null;
  if (exitCode === 2) return "runner_crash";
  return "task_failure";
}
