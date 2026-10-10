import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  assertRunStatusTransition,
  type CreateRunInput,
  type ListRunsQuery,
  type RunStatus,
} from "@sft/schemas";
import { and, asc, count, desc, eq, gte, inArray, sum } from "drizzle-orm";
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

/** Statuses that count against the per-user concurrency limit (M5 §9). */
const ACTIVE_RUN_STATUSES = ["queued", "running"] as const;

/** Max in-flight (queued + running) runs a single user may hold at once. */
const MAX_CONCURRENT_RUNS_PER_USER = 3;

/**
 * Build minutes allowed per calendar month, per plan (M5 §9). `enterprise` is
 * effectively unlimited rather than truly unbounded, so a bug cannot spin up
 * infinite sandboxes.
 */
const PLAN_BUILD_MINUTES_PER_MONTH: Record<string, number> = {
  free: 100,
  team: 3000,
  enterprise: 100000, // effectively unlimited
};

/** First instant of the current UTC calendar month. */
function startOfUtcMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
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

    // M5 §9 guards: concurrency first (cheap count), then the monthly quota,
    // then dedup. A deduped run is returned as-is, so the guards must all pass
    // before it is considered.
    await this.assertWithinConcurrencyLimit(user.id);
    await this.assertWithinQuota(user.id, user.plan);

    const existing = await this.findActiveRun(project.id, input.sha ?? null);
    if (existing) return existing;

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

  /**
   * Counts a user's queued+running runs across every project they own.
   *
   * Counted per *user*, not per project: the limit exists to bound sandbox
   * fan-out, and one user with three repos must not be able to run three
   * sandboxes per repo.
   */
  private async countActiveRuns(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(eq(projects.userId, userId), inArray(runs.status, ACTIVE_RUN_STATUSES)))
      .limit(1);
    return Number(row?.value ?? 0);
  }

  private async assertWithinConcurrencyLimit(userId: string): Promise<void> {
    const active = await this.countActiveRuns(userId);
    if (active >= MAX_CONCURRENT_RUNS_PER_USER) {
      throw new ConflictException("too many concurrent runs");
    }
  }

  /**
   * Repo+SHA dedup: a manual trigger for a sha that is already queued or
   * running returns that run instead of queueing a duplicate sandbox.
   *
   * `sha` is null for most manual runs (the worker resolves HEAD itself), and
   * deduping on null would collapse every trigger into one row, so a null sha
   * always creates a new run.
   */
  private async findActiveRun(projectId: string, sha: string | null): Promise<RunRow | null> {
    if (!sha) return null;
    const [row] = await this.db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.projectId, projectId),
          eq(runs.sha, sha),
          inArray(runs.status, ACTIVE_RUN_STATUSES),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Build minutes this user has already consumed in the current UTC calendar
   * month. Postgres returns `sum(int)` as a numeric string, so it is coerced
   * defensively rather than trusted to be a number.
   */
  private async monthBuildMinutes(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sum(runs.buildMinutes) })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(eq(projects.userId, userId), gte(runs.createdAt, startOfUtcMonth())))
      .limit(1);
    return Number(row?.total ?? 0);
  }

  private async assertWithinQuota(userId: string, plan: string): Promise<void> {
    const quota = PLAN_BUILD_MINUTES_PER_MONTH[plan] ?? PLAN_BUILD_MINUTES_PER_MONTH.free!;
    const used = await this.monthBuildMinutes(userId);
    if (used >= quota) {
      throw new ForbiddenException("monthly build minute quota exceeded");
    }
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
