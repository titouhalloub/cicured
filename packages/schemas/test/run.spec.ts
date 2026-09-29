import { describe, expect, it } from "vitest";
import {
  assertRunStatusTransition,
  canTransitionRunStatus,
  failureKindForExitCode,
  FAILURE_KINDS,
  isTerminalRunStatus,
  RUN_STATUSES,
  RUN_STATUS_TRANSITIONS,
  RunStatus,
  RunStatusTransitionError,
  runStatusForExitCode,
  type FailureKind,
} from "../src/index";

describe("run status contract (Spec §5)", () => {
  it("locks the exact status list", () => {
    expect([...RUN_STATUSES]).toEqual([
      "queued",
      "running",
      "success",
      "failed",
      "runner_crash",
      "timeout",
      "cancelled",
    ]);
  });

  it("locks the exact failure kinds", () => {
    expect([...FAILURE_KINDS]).toEqual([
      "task_failure",
      "runner_crash",
      "timeout",
      "cancelled",
      "oom",
    ]);
  });

  it("rejects statuses outside the enum", () => {
    expect(RunStatus.safeParse("runner_crash").success).toBe(true);
    expect(RunStatus.safeParse("done").success).toBe(false);
  });
});

describe("run status transitions", () => {
  const allowed: Array<[RunStatus, RunStatus]> = [
    ["queued", "running"],
    ["queued", "cancelled"],
    ["running", "success"],
    ["running", "failed"],
    ["running", "runner_crash"],
    ["running", "timeout"],
    ["running", "cancelled"],
  ];

  const denied: Array<[RunStatus, RunStatus]> = [
    ["queued", "success"],
    ["queued", "runner_crash"],
    ["queued", "timeout"],
    ["running", "queued"],
    ["success", "running"],
    ["failed", "running"],
    ["runner_crash", "failed"],
    ["timeout", "success"],
    ["cancelled", "queued"],
  ];

  it.each(allowed)("allows %s -> %s", (from, to) => {
    expect(canTransitionRunStatus(from, to)).toBe(true);
  });

  it.each(denied)("rejects %s -> %s", (from, to) => {
    expect(canTransitionRunStatus(from, to)).toBe(false);
    expect(() => assertRunStatusTransition(from, to)).toThrow(RunStatusTransitionError);
  });

  it("allows idempotent re-writes of the current status", () => {
    for (const status of RUN_STATUSES) {
      expect(canTransitionRunStatus(status, status)).toBe(true);
    }
  });

  it("marks exactly the five terminal statuses", () => {
    expect(RUN_STATUSES.filter(isTerminalRunStatus)).toEqual([
      "success",
      "failed",
      "runner_crash",
      "timeout",
      "cancelled",
    ]);
  });

  it("defines a transition list for every status", () => {
    for (const status of RUN_STATUSES) {
      expect(Array.isArray(RUN_STATUS_TRANSITIONS[status])).toBe(true);
    }
  });

  it("names the offending transition in the error", () => {
    try {
      assertRunStatusTransition("success", "running");
      expect.unreachable("transition should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RunStatusTransitionError);
      expect(String(error)).toContain("success -> running");
    }
  });
});

describe("runner exit-code mapping (Spec §2)", () => {
  const cases: Array<[number, RunStatus, FailureKind | null]> = [
    [0, "success", null],
    [1, "failed", "task_failure"],
    [2, "runner_crash", "runner_crash"],
  ];

  it.each(cases)("maps exit %i to %s / %s", (code, status, kind) => {
    expect(runStatusForExitCode(code)).toBe(status);
    expect(failureKindForExitCode(code)).toBe(kind);
  });
});
