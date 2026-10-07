import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
// The worker's table declarations mirror the API's (D1). Importing the API's
// real definitions is what makes the drift check meaningful: if a column is
// renamed or dropped in the API, this test fails instead of the worker
// silently querying a column that no longer exists.
import { projects as apiProjects } from "../../api/src/db/schema";
import { logs as apiLogs, runs as apiRuns } from "../../api/src/db/tables";
import { logs, projects, runs } from "../src/tables";

/**
 * The worker declares only the columns it touches instead of importing the whole
 * API app. This test fails the moment the two definitions disagree, so the
 * duplication can never silently rot.
 */
function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table))
    .map((column) => column.name)
    .sort();
}

describe("worker table parity with apps/api", () => {
  it("declares every runs column it needs with the same DB names", () => {
    const api = new Set(columnNames(apiRuns));
    for (const name of columnNames(runs)) {
      expect(api.has(name)).toBe(true);
    }
  });

  it("declares every projects column it needs with the same DB names", () => {
    const api = new Set(columnNames(apiProjects));
    for (const name of columnNames(projects)) {
      expect(api.has(name)).toBe(true);
    }
  });

  it("covers exactly the columns the run job reads and writes", () => {
    expect(columnNames(runs)).toEqual([
      "branch",
      "build_minutes",
      "created_at",
      "exit_code",
      "failure_kind",
      "finished_at",
      "id",
      "project_id",
      "s3_log_key",
      "started_at",
      "status",
      "trigger",
    ]);
    expect(columnNames(projects)).toEqual([
      "default_branch",
      "id",
      "installation_id_enc",
      "repo_full_name",
    ]);
  });

  it("declares every logs column it needs with the same DB names", () => {
    const api = new Set(columnNames(apiLogs));
    for (const name of columnNames(logs)) {
      expect(api.has(name)).toBe(true);
    }
    expect(columnNames(logs)).toEqual([
      "byte_size",
      "created_at",
      "id",
      "run_id",
      "s3_key",
      "sequence",
      "stream",
    ]);
  });
});