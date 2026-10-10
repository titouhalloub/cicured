import { describe, expect, it, vi } from "vitest";
import { RunStatusTransitionError } from "@sft/schemas";
import { RunsService } from "../src/runs/runs.service";
import type { Database, FindingRow, ProjectRow, RunRow, SuggestionRow } from "../src/db";
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

const FINDING_ID = "44444444-4444-4444-8444-444444444444";
const SUGGESTION_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_USER_ID = "66666666-6666-4666-8666-666666666666";

function makeFindingRow(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: FINDING_ID,
    runId: RUN_ID,
    severity: "error",
    category: "typecheck",
    ruleId: "TS2339",
    file: "apps/api/src/auth/github.client.ts",
    line: 87,
    col: 14,
    message: "Property 'clientId' does not exist on type 'AppConfig'.",
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

function makeSuggestionRow(overrides: Partial<SuggestionRow> = {}): SuggestionRow {
  return {
    id: SUGGESTION_ID,
    findingId: FINDING_ID,
    model: "claude-sonnet-4-5",
    promptVersion: "m4a-v1",
    patchDiff: "--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,3 @@\n-a\n+b\n",
    explanation: "Typo in the accessor name.",
    confidence: 0.87,
    accepted: null,
    createdAt: new Date("2026-10-01T09:30:00.000Z"),
    ...overrides,
  };
}

/**
 * Minimal drizzle chain stub. Uses a single documented cast instead of pulling
 * a full database double into unit tests; real infrastructure behaviour is
 * covered by runs.integration.spec.ts.
 *
 * Selects come in two flavours, mirroring how the service uses them:
 *  - `ownedRows` — limit(1)-terminated (ownership walks, single row)
 *  - `rows`      — orderBy(...)-terminated (findings / suggestions lists)
 */
function makeDbStub(
  options: {
    inserted?: RunRow;
    updated?: RunRow;
    ownedRows?: unknown[];
    rows?: unknown[];
  } = {},
) {
  const calls = {
    insertedValues: [] as unknown[],
    updates: [] as unknown[],
    orderBy: [] as unknown[][],
    where: [] as unknown[],
    joinCount: 0,
  };
  const ownedRows = options.ownedRows ?? [];
  const rows = options.rows ?? [];

  const terminal = {
    orderBy: (...args: unknown[]) => {
      calls.orderBy.push(args);
      return Promise.resolve(rows);
    },
    limit: () => Promise.resolve(ownedRows),
  };
  const joined = {
    innerJoin: () => {
      calls.joinCount += 1;
      return joined;
    },
    where: (arg: unknown) => {
      calls.where.push(arg);
      return terminal;
    },
    orderBy: (...args: unknown[]) => {
      calls.orderBy.push(args);
      return Promise.resolve(rows);
    },
  };
  const updateResult = Promise.resolve([options.updated]);
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
        where: () => {
          calls.updates.push(values);
          // Awaitable directly (no .returning()) and still exposing .returning()
          // for the transition() path, so both call styles work.
          return Object.assign(updateResult, {
            returning: () => Promise.resolve([options.updated]),
          });
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (arg: unknown) => {
          calls.where.push(arg);
          return terminal;
        },
        orderBy: (...args: unknown[]) => {
          calls.orderBy.push(args);
          return Promise.resolve(rows);
        },
        innerJoin: () => {
          calls.joinCount += 1;
          return joined;
        },
      }),
    }),
  };
  return { db: stub as unknown as Database, calls };
}

/** drizzle wraps order args in SQL; recover the column name + direction. */
function orderArgInfo(arg: unknown): { column: string; direction: "asc" | "desc" } {
  const chunks =
    (arg as { queryChunks?: Array<{ name?: string; value?: unknown }> } | null)
      ?.queryChunks ?? [];
  const column = chunks.find((chunk) => typeof chunk.name === "string")?.name ?? "";
  const direction = chunks
    .map((chunk) => JSON.stringify(chunk.value ?? ""))
    .join("")
    .includes("desc")
    ? "desc"
    : "asc";
  return { column, direction };
}

/** drizzle wraps `eq(col, value)` in SQL; recover the compared column name. */
function whereColumnName(arg: unknown): string {
  const chunks = (arg as { queryChunks?: unknown[] } | null)?.queryChunks ?? [];
  const column = chunks.find(
    (chunk) => typeof (chunk as { name?: string }).name === "string",
  ) as { name: string } | undefined;
  return column?.name ?? "";
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

describe("RunsService.findingsForRun (M4b-2a: GET /runs/:id/findings)", () => {
  function makeService(db: Database, project: ProjectRow | null = makeProjectRow()) {
    return new RunsService(db, {} as unknown as RunsQueue, makeProjectsStub(project));
  }

  it("returns [] for a run with no findings", async () => {
    const { db } = makeDbStub({ ownedRows: [makeRunRow()], rows: [] });

    await expect(makeService(db).findingsForRun({ id: USER_ID } as never, RUN_ID)).resolves.toEqual(
      [],
    );
  });

  it("throws NotFoundException for a foreign-owned run", async () => {
    const { db, calls } = makeDbStub({ ownedRows: [makeRunRow()], rows: [] });

    await expect(
      makeService(db, null).findingsForRun({ id: USER_ID } as never, RUN_ID),
    ).rejects.toMatchObject({ status: 404 });
    // The findings query never ran: ownership is checked first.
    expect(calls.orderBy).toHaveLength(0);
  });

  it("orders by severity desc, file asc, line asc", async () => {
    const errorInB = makeFindingRow({ severity: "error", file: "apps/api/src/b.ts", line: 20 });
    const warningInA = makeFindingRow({ severity: "warning", file: "apps/api/src/a.ts", line: 4 });
    const { db, calls } = makeDbStub({
      ownedRows: [makeRunRow()],
      rows: [errorInB, warningInA],
    });

    const rows = await makeService(db).findingsForRun({ id: USER_ID } as never, RUN_ID);

    // Rows pass through untouched; Postgres applies the ORDER BY.
    expect(rows).toEqual([errorInB, warningInA]);
    expect(calls.orderBy).toHaveLength(1);
    expect(calls.orderBy[0]!.map(orderArgInfo)).toEqual([
      { column: "severity", direction: "desc" },
      { column: "file", direction: "asc" },
      { column: "line", direction: "asc" },
    ]);
  });
});

describe("RunsService.suggestionsForRun (M4b-2a: GET /runs/:id/suggestions)", () => {
  function makeService(db: Database, project: ProjectRow | null = makeProjectRow()) {
    return new RunsService(db, {} as unknown as RunsQueue, makeProjectsStub(project));
  }

  it("returns [] when none exist", async () => {
    const { db } = makeDbStub({ ownedRows: [makeRunRow()], rows: [] });

    await expect(
      makeService(db).suggestionsForRun({ id: USER_ID } as never, RUN_ID),
    ).resolves.toEqual([]);
  });

  it("joins suggestions through findings and scopes to the run", async () => {
    const row = makeSuggestionRow();
    const { db, calls } = makeDbStub({ ownedRows: [makeRunRow()], rows: [row] });

    const suggestions = await makeService(db).suggestionsForRun({ id: USER_ID } as never, RUN_ID);

    // findings -> runs -> projects: three joins, filtered on findings.run_id.
    expect(calls.joinCount).toBe(3);
    // Two filters: getOwnedRun's runs.id lookup, then the run scoping.
    expect(calls.where).toHaveLength(2);
    expect(whereColumnName(calls.where[1])).toBe("run_id");
    expect(suggestions).toEqual([
      {
        id: SUGGESTION_ID,
        findingId: FINDING_ID,
        model: "claude-sonnet-4-5",
        promptVersion: "m4a-v1",
        patchDiff: row.patchDiff,
        explanation: row.explanation,
        confidence: 0.87,
        accepted: null,
        // DB timestamps go out as ISO strings (Spec §5).
        createdAt: "2026-10-01T09:30:00.000Z",
      },
    ]);
  });
});

describe("RunsService.recordFeedback (M4b-2a: POST /suggestions/:id/feedback)", () => {
  function makeService(db: Database, project: ProjectRow | null = makeProjectRow()) {
    return new RunsService(db, {} as unknown as RunsQueue, makeProjectsStub(project));
  }

  it("returns 404 for a foreign-owned suggestion", async () => {
    const { db, calls } = makeDbStub({ ownedRows: [{ userId: OTHER_USER_ID }] });

    await expect(
      makeService(db).recordFeedback(USER_ID, SUGGESTION_ID, true),
    ).rejects.toMatchObject({ status: 404, message: "suggestion not found" });
    // No write happened for a suggestion the caller does not own.
    expect(calls.updates).toHaveLength(0);
  });

  it("returns 404 when the suggestion does not exist", async () => {
    const { db } = makeDbStub({ ownedRows: [] });

    await expect(
      makeService(db).recordFeedback(USER_ID, SUGGESTION_ID, false),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("updates accepted and returns { ok: true }", async () => {
    const { db, calls } = makeDbStub({ ownedRows: [{ userId: USER_ID }] });

    await expect(
      makeService(db).recordFeedback(USER_ID, SUGGESTION_ID, true),
    ).resolves.toEqual({ ok: true });
    expect(calls.updates[0]).toMatchObject({ accepted: true });
  });

  it("can flip an accepted suggestion back to rejected", async () => {
    const { db, calls } = makeDbStub({ ownedRows: [{ userId: USER_ID }] });

    await makeService(db).recordFeedback(USER_ID, SUGGESTION_ID, false);

    expect(calls.updates[0]).toMatchObject({ accepted: false });
  });
});
