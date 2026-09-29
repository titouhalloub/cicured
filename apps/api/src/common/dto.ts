import type { ProjectSummary, RunSummary, SessionUser } from "@sft/schemas";
import type { ProjectRow, RunRow, UserRow } from "../db";

/** DB row -> API DTO mapping; timestamps go out as ISO-8601 (Spec §5 shapes). */

export function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    provider: "github",
    createdAt: row.createdAt.toISOString(),
  };
}

export function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    provider: "github",
    repoFullName: row.repoFullName,
    defaultBranch: row.defaultBranch,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRunSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    sha: row.sha,
    branch: row.branch,
    trigger: row.trigger,
    status: row.status,
    exitCode: row.exitCode,
    failureKind: row.failureKind,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    buildMinutes: row.buildMinutes,
  };
}
