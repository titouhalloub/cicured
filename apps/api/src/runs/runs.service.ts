import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import {
  assertRunStatusTransition,
  type CreateRunInput,
  type ListRunsQuery,
  type RunStatus,
} from "@sft/schemas";
import { asc, count, desc, eq } from "drizzle-orm";
import {
  DRIZZLE,
  findings,
  projects,
  runs,
  suggestions,
  type Database,
  type FindingRow,
  type RunRow,
  type UserRow,
} from "../db";
import { ProjectsService } from "../projects/projects.service";
import { RunsQueue } from "../queue/runs-queue.service";

/**
 * API wire shape for GET /runs/:id/suggestions. The DB row is wider than the
 * `Suggestion` schema in @sft/schemas — it carries the row id, the finding it
 * hangs off and its creation time — so those extras live here rather than in
 * the shared contract.
 */
export interface SuggestionWithId {
  id: string;
  findingId: string;
  model: string;
  promptVersion: string;
  patchDiff: string;
  explanation: string;
  confidence: number;
  accepted: boolean | null;
  /** ISO-8601 (Spec §5: timestamps go out as strings). */
  createdAt: string;
}

@Injectable()
export class RunsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly queue: RunsQueue,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * POST /projects/:id/run: insert a `queued` row, then enqueue the BullMQ job
   * (`jobId = runId`). Enqueue failure marks the row `cancelled` so no orphan
   * `queued` rows survive a Redis outage.
   */
  async createManualRun(
    user: UserRow,
    projectId: string,
    input: CreateRunInput,
  ): Promise<RunRow> {
    const project = await this.projects.findOwned(user.id, projectId);
    if (!project) throw new NotFoundException("project not found");

    const [row] = await this.db
      .insert(runs)
      .values({
        projectId: project.id,
        sha: input.sha ?? null,
        branch: input.branch ?? project.defaultBranch,
        trigger: "manual",
        status: "queued",
      })
      .returning();
    if (!row) throw new Error("run insert returned no row");

    try {
      await this.queue.enqueueRun({ runId: row.id, projectId: project.id });
    } catch (error) {
      await this.transition(row, "cancelled", { finishedAt: new Date() });
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new ServiceUnavailableException(`run queue unavailable: ${reason}`);
    }
    return row;
  }

  async getOwnedRun(user: UserRow, runId: string): Promise<RunRow> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    if (!row) throw new NotFoundException("run not found");
    const project = await this.projects.findOwned(user.id, row.projectId);
    if (!project) throw new NotFoundException("run not found");
    return row;
  }

  /** GET /runs/:id/findings — every finding for a run, worst first (Spec §5). */
  async findingsForRun(user: UserRow, runId: string): Promise<FindingRow[]> {
    await this.getOwnedRun(user, runId);
    return this.db
      .select()
      .from(findings)
      .where(eq(findings.runId, runId))
      .orderBy(desc(findings.severity), asc(findings.file), asc(findings.line));
  }

  /** GET /runs/:id/suggestions — suggestions joined through their findings. */
  async suggestionsForRun(user: UserRow, runId: string): Promise<SuggestionWithId[]> {
    await this.getOwnedRun(user, runId);
    const rows = await this.db
      .select({
        id: suggestions.id,
        findingId: suggestions.findingId,
        model: suggestions.model,
        promptVersion: suggestions.promptVersion,
        patchDiff: suggestions.patchDiff,
        explanation: suggestions.explanation,
        confidence: suggestions.confidence,
        accepted: suggestions.accepted,
        createdAt: suggestions.createdAt,
      })
      .from(suggestions)
      .innerJoin(findings, eq(findings.id, suggestions.findingId))
      .innerJoin(runs, eq(runs.id, findings.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(eq(findings.runId, runId))
      .orderBy(desc(suggestions.createdAt));
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /**
   * POST /suggestions/:id/feedback (Spec §4 step 11).
   *
   * The suggestions table FKs to findings only, so ownership is walked
   * suggestion -> finding -> run -> project. Any miss answers 404
   * "suggestion not found": a caller must not be able to probe whether a
   * suggestion exists in someone else's account.
   */
  async recordFeedback(
    userId: string,
    suggestionId: string,
    accepted: boolean,
  ): Promise<{ ok: true }> {
    const [owner] = await this.db
      .select({ userId: projects.userId })
      .from(suggestions)
      .innerJoin(findings, eq(findings.id, suggestions.findingId))
      .innerJoin(runs, eq(runs.id, findings.runId))
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(eq(suggestions.id, suggestionId))
      .limit(1);
    if (!owner || owner.userId !== userId) {
      throw new NotFoundException("suggestion not found");
    }
    await this.db
      .update(suggestions)
      .set({ accepted })
      .where(eq(suggestions.id, suggestionId));
    return { ok: true };
  }

  async listProjectRuns(
    user: UserRow,
    projectId: string,
    query: ListRunsQuery,
  ): Promise<{ items: RunRow[]; total: number }> {
    const project = await this.projects.findOwned(user.id, projectId);
    if (!project) throw new NotFoundException("project not found");

    const [items, totals] = await Promise.all([
      this.db
        .select()
        .from(runs)
        .where(eq(runs.projectId, projectId))
        .orderBy(desc(runs.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ value: count() }).from(runs).where(eq(runs.projectId, projectId)),
    ]);
    return { items, total: totals[0]?.value ?? 0 };
  }

  /**
   * Guarded status change using the shared Spec §5 state machine. The M2
   * worker is the primary caller; M1 covers transitions with tests.
   */
  async transition(
    row: RunRow,
    next: RunStatus,
    fields: Partial<Pick<RunRow, "exitCode" | "failureKind" | "startedAt" | "finishedAt" | "buildMinutes" | "s3LogKey" | "s3ReportKey">> = {},
  ): Promise<RunRow> {
    assertRunStatusTransition(row.status, next);
    const [updated] = await this.db
      .update(runs)
      .set({ status: next, ...fields })
      .where(eq(runs.id, row.id))
      .returning();
    if (!updated) throw new Error("run update returned no row");
    return updated;
  }
}
