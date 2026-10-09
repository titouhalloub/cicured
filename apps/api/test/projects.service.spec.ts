import { describe, expect, it } from "vitest";
import { ProjectsService } from "../src/projects/projects.service";
import type { CryptoService } from "../src/common/crypto.service";
import type { GitHubClient } from "../src/auth/github.client";
import type { Database, ProjectRow } from "../src/db";

const USER_ID = "33333333-3333-4333-8333-333333333333";

function makeProjectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
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

/**
 * Minimal drizzle select-chain stub (`select().from().where().orderBy()`),
 * same documented-cast pattern as runs.service.spec.ts. The stub resolves rows
 * in the order Postgres would return them (created_at DESC).
 */
function makeDbStub(rows: ProjectRow[]) {
  const calls = { where: [] as unknown[], orderBy: [] as unknown[] };
  const stub = {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          calls.where.push(predicate);
          return {
            orderBy: (order: unknown) => {
              calls.orderBy.push(order);
              return Promise.resolve(rows);
            },
          };
        },
      }),
    }),
  };
  return { db: stub as unknown as Database, calls };
}

/** Walks a drizzle SQL expression down to its leaves (chunks, params, text). */
function sqlLeaves(node: unknown, depth = 0): unknown[] {
  if (depth > 8) return [];
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap((entry) => sqlLeaves(entry, depth + 1));
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.queryChunks)) return sqlLeaves(record.queryChunks, depth + 1);
    if (Array.isArray(record.text)) {
      return record.text.filter((chunk): chunk is string => typeof chunk === "string");
    }
    if ("value" in record) {
      // drizzle Param bindings carry the raw value; StringChunk carries text[].
      return Array.isArray(record.value)
        ? sqlLeaves(record.value, depth + 1)
        : [record.value];
    }
    return [];
  }
  return [];
}

function makeService(db: Database): ProjectsService {
  return new ProjectsService(db, {} as unknown as CryptoService, {} as unknown as GitHubClient);
}

describe("ProjectsService.listForUser (GET /projects)", () => {
  it("returns the user's projects mapped to ProjectSummary, newest first", async () => {
    const newer = makeProjectRow({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      repoFullName: "acme/newer",
      createdAt: new Date("2026-10-02T09:30:00.000Z"),
    });
    const older = makeProjectRow({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      repoFullName: "acme/older",
      createdAt: new Date("2026-09-01T09:30:00.000Z"),
    });
    const { db, calls } = makeDbStub([newer, older]); // desc order as returned by Postgres

    const result = await makeService(db).listForUser(USER_ID);

    expect(result).toEqual([
      {
        id: newer.id,
        provider: "github",
        repoFullName: "acme/newer",
        defaultBranch: "main",
        createdAt: "2026-10-02T09:30:00.000Z",
      },
      {
        id: older.id,
        provider: "github",
        repoFullName: "acme/older",
        defaultBranch: "main",
        createdAt: "2026-09-01T09:30:00.000Z",
      },
    ]);
    // Ordering is requested as created_at DESC, and rows keep that order.
    expect(calls.orderBy).toHaveLength(1);
    expect(
      sqlLeaves(calls.orderBy[0]).some(
        (leaf) => typeof leaf === "string" && leaf.toLowerCase().includes("desc"),
      ),
    ).toBe(true);
  });

  it("filters the query by userId", async () => {
    const { db, calls } = makeDbStub([makeProjectRow()]);

    await makeService(db).listForUser(USER_ID);

    expect(calls.where).toHaveLength(1);
    expect(sqlLeaves(calls.where[0])).toContain(USER_ID);
  });
});
