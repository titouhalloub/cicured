import { describe, expect, it, vi } from "vitest";
import { RunStatusTransitionError } from "@sft/schemas";
import { RunsService } from "../src/runs/runs.service";
import type { Database, ProjectRow, RunRow } from "../src/db";
import type { ProjectsService } from "../src/projects/projects.service";
import type { RunsQueue } from "../src/queue/runs-queue.service";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "33333333-3333-4333-8333-333333333333";

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: PROJECT_ID,
    userId: USER_ID,
    provider: "github",
    repoFullName: "acme/web",
    installationIdEnc: "v1:iv:tag:cipher",
    defaultBranch: "main",
    webhookId: null,
    createdAt: new Date("2026-09-28T12:00:00.000Z"),
    ...overrides,
  };
}

function makeRunRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: RUN_ID,
    projectId: PROJECT_ID,
    sha: null,
    branch: "main",
    trigger: "manual",
    status: "queued",
    exitCode: null,
    failureKind: null,
    createdAt: new Date("2026-09-28T12:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    buildMinutes: null,
    s3LogKey: null,
    s3ReportKey: null,
    ...overrides,
  };
}

/**
 * Minimal drizzle chain stub. Uses a single documented cast instead of pulling
 * a full database double into unit tests; real infrastructure behaviour is
 * covered by runs.integration.spec.ts.
 */
function makeDbStub(options: { inserted?: RunRow; updated?: RunRow } = {}) {
  const calls = { insertedValues: [] as unknown[], updates: [] as unknown[] };
  const stub = {
    insert: () => ({
      values: (values: unknown) => ({
        returning: () => {
          calls.insertedValues.push(values);
          return Promise.resolve([options.inserted]);
        },
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            calls.updates.push(values);
            return Promise.resolve([options.updated]);
          },
        }),
      }),
    }),
  };
  return { db: stub as unknown as Database, calls };
}

function makeProjectsStub(project: ProjectRow | null) {
  return { findOwned: () => Promise.resolve(project) } as unknown as ProjectsService;
}

describe("RunsService.createManualRun (Spec §14 acceptance: queued row + BullMQ job)", () => {
  it("inserts a queued run and enqueues the job for that run id", async () => {
    const inserted = makeRunRow();
    const { db, calls } = makeDbStub({ inserted });
    const enqueued: Array<{ runId: string; projectId: string }> = [];
    const queue = {
      enqueueRun: (data: { runId: string; projectId: string }) => {
        enqueued.push(data);
        return Promise.resolve();
      },
    } as unknown as RunsQueue;

    const service = new RunsService(db, queue, makeProjectsStub(makeProjectRow()));
    const row = await service.createManualRun({ id: USER_ID } as never, PROJECT_ID, {});

    expect(row.status).toBe("queued");
    expect(calls.insertedValues[0]).toMatchObject({
      projectId: PROJECT_ID,
      trigger: "manual",
      status: "queued",
      branch: "main",
      sha: null,
    });
    expect(enqueued).toEqual([{ runId: RUN_ID, projectId: PROJECT_ID }]);
  });

  it("honours sha/branch overrides from the request body", async () => {
    const { db, calls } = makeDbStub({
      inserted: makeRunRow({ branch: "release", sha: "abc1234" }),
    });
    const service = new RunsService(
      db,
      { enqueueRun: () => Promise.resolve() } as unknown as RunsQueue,
      makeProjectsStub(makeProjectRow({ defaultBranch: "main" })),
    );

    await service.createManualRun({ id: USER_ID } as never, PROJECT_ID, {
      branch: "release",
      sha: "abc1234",
    });

    expect(calls.insertedValues[0]).toMatchObject({ branch: "release", sha: "abc1234" });
  });

  it("returns 404 for a project the user does not own", async () => {
    const { db } = makeDbStub();
    const service = new RunsService(
      db,
      { enqueueRun: () => Promise.resolve() } as unknown as RunsQueue,
      makeProjectsStub(null),
    );

    await expect(
      service.createManualRun({ id: USER_ID } as never, PROJECT_ID, {}),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("marks the run cancelled and returns 503 when the queue is unavailable", async () => {
    const { db, calls } = makeDbStub({
      inserted: makeRunRow(),
      updated: makeRunRow({ status: "cancelled" }),
    });
    const failingQueue = {
      enqueueRun: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    } as unknown as RunsQueue;

    const service = new RunsService(db, failingQueue, makeProjectsStub(makeProjectRow()));

    await expect(
      service.createManualRun({ id: USER_ID } as never, PROJECT_ID, {}),
    ).rejects.toMatchObject({ status: 503 });

    // No orphan `queued` rows: the row was cancelled and stamped.
    expect(calls.updates[0]).toMatchObject({ status: "cancelled" });
  });
});

describe("RunsService.transition (Spec §5 state machine)", () => {
  it("applies a legal transition", async () => {
    const { db, calls } = makeDbStub({
      updated: makeRunRow({ status: "running", startedAt: new Date() }),
    });
    const service = new RunsService(
      db,
      {} as unknown as RunsQueue,
      makeProjectsStub(makeProjectRow()),
    );

    const updated = await service.transition(makeRunRow({ status: "queued" }), "running", {
      startedAt: new Date(),
    });

    expect(updated.status).toBe("running");
    expect(calls.updates[0]).toMatchObject({ status: "running" });
  });

  it("rejects an illegal transition before touching the database", async () => {
    const { db, calls } = makeDbStub();
    const service = new RunsService(
      db,
      {} as unknown as RunsQueue,
      makeProjectsStub(makeProjectRow()),
    );

    await expect(
      service.transition(makeRunRow({ status: "success" }), "failed"),
    ).rejects.toBeInstanceOf(RunStatusTransitionError);
    expect(calls.updates).toHaveLength(0);
  });
});
