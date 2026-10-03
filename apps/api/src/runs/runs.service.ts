import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { assertRunStatusTransition, type CreateRunInput, type ListRunsQuery, type RunStatus } from "@sft/schemas";
import { count, desc, eq } from "drizzle-orm";
import { DRIZZLE, runs, type Database, type RunRow, type UserRow } from "../db";
import { ProjectsService } from "../projects/projects.service";
import { RunsQueue } from "../queue/runs-queue.service";

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
