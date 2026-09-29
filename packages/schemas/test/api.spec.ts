import { describe, expect, it } from "vitest";
import {
  CreateProjectInput,
  CreateRunInput,
  ListRunsQuery,
  ProjectSummary,
  RunSummary,
  Suggestion,
} from "../src/index";

const UUID = "6f1c9a54-6f0e-4a25-9a8b-1c2d3e4f5a6b";

describe("CreateProjectInput", () => {
  it("accepts a valid body with and without a default branch", () => {
    expect(
      CreateProjectInput.safeParse({ installationId: 1234, repoFullName: "acme/web" }).success,
    ).toBe(true);
    expect(
      CreateProjectInput.safeParse({
        installationId: 1234,
        repoFullName: "acme/web-app.ts",
        defaultBranch: "main",
      }).success,
    ).toBe(true);
  });

  it.each([["owner"], ["owner/"], ["/repo"], ["own er/repo"], ["owner/re po"], [""]])(
    "rejects repo name %j",
    (repoFullName) => {
      expect(
        CreateProjectInput.safeParse({ installationId: 1, repoFullName }).success,
      ).toBe(false);
    },
  );

  it("rejects a non-positive or non-integer installation id", () => {
    for (const installationId of [0, -1, 1.5]) {
      expect(
        CreateProjectInput.safeParse({ installationId, repoFullName: "acme/web" }).success,
      ).toBe(false);
    }
  });
});

describe("CreateRunInput", () => {
  it("accepts a 7-40 char hex sha and an optional branch", () => {
    expect(CreateRunInput.safeParse({ sha: "a1b2c3d" }).success).toBe(true);
    expect(
      CreateRunInput.safeParse({ sha: "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2", branch: "main" })
        .success,
    ).toBe(true);
    expect(CreateRunInput.safeParse({}).success).toBe(true);
  });

  it.each([["xyz"], ["abc123"], ["z".repeat(40)]])("rejects sha %j", (sha) => {
    expect(CreateRunInput.safeParse({ sha }).success).toBe(false);
  });
});

describe("ListRunsQuery", () => {
  it("defaults to limit 20 / offset 0", () => {
    expect(ListRunsQuery.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("coerces query-string numbers", () => {
    expect(ListRunsQuery.parse({ limit: "5", offset: "10" })).toEqual({ limit: 5, offset: 10 });
  });

  it("rejects out-of-range pagination", () => {
    expect(ListRunsQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(ListRunsQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(ListRunsQuery.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("API DTO schemas", () => {
  it("requires a UUID project id and ISO created_at", () => {
    expect(
      ProjectSummary.safeParse({
        id: UUID,
        provider: "github",
        repoFullName: "acme/web",
        defaultBranch: "main",
        createdAt: "2026-09-28T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      ProjectSummary.safeParse({
        id: "not-a-uuid",
        provider: "github",
        repoFullName: "acme/web",
        defaultBranch: "main",
        createdAt: "2026-09-28T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      ProjectSummary.safeParse({
        id: UUID,
        provider: "gitlab",
        repoFullName: "acme/web",
        defaultBranch: "main",
        createdAt: "2026-09-28T12:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("accepts a queued RunSummary with all nullable fields unset", () => {
    const queued = {
      id: UUID,
      projectId: UUID,
      sha: null,
      branch: "main",
      trigger: "manual",
      status: "queued",
      exitCode: null,
      failureKind: null,
      createdAt: "2026-09-28T12:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      buildMinutes: null,
    };
    expect(RunSummary.safeParse(queued).success).toBe(true);
    expect(RunSummary.safeParse({ ...queued, status: "broken" }).success).toBe(false);
    expect(RunSummary.safeParse({ ...queued, trigger: "webhook" }).success).toBe(false);
  });
});

describe("Suggestion", () => {
  const base = {
    model: "claude-sonnet-4-5",
    promptVersion: "v1",
    patchDiff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@\n-const sub = user.sub\n+const sub = session.sub\n",
    explanation: "Use the session sub claim.",
    confidence: 0.4,
    accepted: null,
  };

  it("accepts a schema-valid suggestion", () => {
    expect(Suggestion.safeParse(base).success).toBe(true);
  });

  it("accepts confidence at both bounds and either acceptance state", () => {
    expect(Suggestion.safeParse({ ...base, confidence: 0 }).success).toBe(true);
    expect(Suggestion.safeParse({ ...base, confidence: 1, accepted: false }).success).toBe(true);
    expect(Suggestion.safeParse({ ...base, accepted: true }).success).toBe(true);
  });

  it("rejects out-of-range confidence and an empty patch", () => {
    expect(Suggestion.safeParse({ ...base, confidence: 1.01 }).success).toBe(false);
    expect(Suggestion.safeParse({ ...base, confidence: -0.1 }).success).toBe(false);
    expect(Suggestion.safeParse({ ...base, patchDiff: "" }).success).toBe(false);
  });
});
