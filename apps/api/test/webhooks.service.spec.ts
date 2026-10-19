import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CryptoService } from "../src/common/crypto.service";
import type { AppConfig } from "../src/config/app-config.service";
import { projects, webhookDeliveries } from "../src/db";
import type { Database } from "../src/db";
import type { RunsQueue } from "../src/queue/runs-queue.service";
import type { GitHubClient } from "../src/auth/github.client";
import type { DiffReviewLlm } from "../src/webhooks/diff-review.llm";
import { WebhooksService } from "../src/webhooks/webhooks.service";
import { makeConfig } from "./test-utils";

const SECRET = "test-webhook-secret";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

const PUSH = {
  ref: "refs/heads/main",
  after: "0123456789abcdef0123456789abcdef01234567",
  repository: { full_name: "acme/web", default_branch: "main" },
  installation: { id: 12345 },
};
const BODY = Buffer.from(JSON.stringify(PUSH), "utf8");

const PROJECT = {
  id: "22222222-2222-4222-8222-222222222222",
  installationIdEnc: "v1:iv:tag:ct",
};

interface DbOptions {
  /** Rows returned by the projects lookup. */
  projectRows?: unknown[];
  /** Rows returned by the queued/running dedup select. */
  dedupRows?: unknown[];
  /** Rows returned by the runs insert RETURNING clause. */
  insertedRows?: { id: string }[];
  /** Error thrown by the webhook_deliveries insert, when present. */
  deliveryError?: unknown;
}

/** Drizzle double covering exactly the four queries WebhooksService issues. */
function dbDouble(options: DbOptions = {}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => {
            if (table === projects) return options.projectRows ?? [];
            return options.dedupRows ?? [];
          }),
        })),
      })),
    })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(() => {
        if (table === webhookDeliveries) {
          // Awaiting the values() builder is what executes the insert.
          return {
            then: (
              resolve: (value: unknown) => unknown,
              reject: (reason: unknown) => unknown,
            ) => {
              if (options.deliveryError) {
                return Promise.reject(options.deliveryError).then(resolve, reject);
              }
              return Promise.resolve([]).then(resolve, reject);
            },
          };
        }
        return {
          returning: vi.fn(async () => options.insertedRows ?? [{ id: RUN_ID }]),
        };
      }),
    })),
  };
}

function cryptoDouble(decrypt: () => string): CryptoService {
  return { decrypt: vi.fn(decrypt) } as unknown as CryptoService;
}

function queueDouble(): { enqueueRun: ReturnType<typeof vi.fn> } {
  return { enqueueRun: vi.fn(async () => undefined) };
}

function githubDouble() {
  return {
    appConfigured: true,
    getPullRequestDiff: vi.fn(async () => ""),
    createPullRequestReview: vi.fn(async () => undefined),
  };
}

function llmDouble() {
  return {
    enabled: true,
    reviewHunk: vi.fn(async () => ({ summary: "", comments: [] })),
  };
}

function makeService(
  db: ReturnType<typeof dbDouble>,
  options: {
    config?: AppConfig;
    decrypt?: () => string;
    queue?: { enqueueRun: ReturnType<typeof vi.fn> };
    github?: ReturnType<typeof githubDouble>;
    llm?: ReturnType<typeof llmDouble>;
  } = {},
) {
  const queue = options.queue ?? queueDouble();
  const service = new WebhooksService(
    options.config ?? makeConfig({ GITHUB_WEBHOOK_SECRET: SECRET }),
    db as unknown as Database,
    cryptoDouble(options.decrypt ?? (() => "12345")),
    queue as unknown as RunsQueue,
    (options.github ?? githubDouble()) as unknown as GitHubClient,
    (options.llm ?? llmDouble()) as unknown as DiffReviewLlm,
  );
  return { service, queue };
}

function pushBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({ ...PUSH, ...overrides }), "utf8");
}

describe("WebhooksService", () => {
  describe("verifySignature", () => {
    it("accepts a correct sha256= hex signature", () => {
      const { service } = makeService(dbDouble());
      const signature = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`;

      expect(service.verifySignature(BODY, signature)).toBe(true);
    });

    it("rejects a wrong signature", () => {
      const { service } = makeService(dbDouble());
      const wrong = `sha256=${"0".repeat(64)}`;

      expect(service.verifySignature(BODY, wrong)).toBe(false);
    });

    it("rejects a signature with wrong length", () => {
      const { service } = makeService(dbDouble());

      expect(service.verifySignature(BODY, "sha256=abc")).toBe(false);
    });

    it("rejects when the webhook secret is unset", () => {
      const { service } = makeService(dbDouble(), { config: makeConfig() });
      const signature = `sha256=${createHmac("sha256", SECRET).update(BODY).digest("hex")}`;

      expect(service.verifySignature(BODY, signature)).toBe(false);
      expect(service.verifySignature(BODY, undefined)).toBe(false);
    });
  });

  describe("recordDelivery", () => {
    it("returns true on first insert", async () => {
      const db = dbDouble();
      const { service } = makeService(db);

      await expect(service.recordDelivery("delivery-1", BODY)).resolves.toBe(true);
      expect(db.insert).toHaveBeenCalledWith(webhookDeliveries);
    });

    it("returns false on unique violation (code 23505)", async () => {
      const duplicate = Object.assign(new Error("duplicate key value"), {
        code: "23505",
      });
      const { service } = makeService(dbDouble({ deliveryError: duplicate }));

      await expect(service.recordDelivery("delivery-1", BODY)).resolves.toBe(false);
    });

    it("rethrows other errors", async () => {
      const { service } = makeService(
        dbDouble({ deliveryError: new Error("connection terminated") }),
      );

      await expect(service.recordDelivery("delivery-1", BODY)).rejects.toThrow(
        "connection terminated",
      );
    });
  });

  describe("handleGithubPush", () => {
    it("returns ignored when the payload fails zod", async () => {
      const { service } = makeService(dbDouble());
      const invalid = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }), "utf8");

      await expect(service.handleGithubPush(invalid)).resolves.toEqual({
        status: "ignored",
      });
      await expect(
        service.handleGithubPush(Buffer.from("{not json", "utf8")),
      ).resolves.toEqual({ status: "ignored" });
    });

    it("returns branch-filtered for a non-default branch", async () => {
      const { service } = makeService(dbDouble());

      await expect(
        service.handleGithubPush(pushBody({ ref: "refs/heads/dev" })),
      ).resolves.toEqual({ status: "branch-filtered" });
    });

    it("returns no-matching-project when no project row exists", async () => {
      const { service } = makeService(dbDouble({ projectRows: [] }));

      await expect(service.handleGithubPush(BODY)).resolves.toEqual({
        status: "no-matching-project",
      });
    });

    it("returns installation-mismatch when the decrypted id differs", async () => {
      const { service } = makeService(dbDouble({ projectRows: [PROJECT] }), {
        decrypt: () => "99999",
      });

      await expect(service.handleGithubPush(BODY)).resolves.toEqual({
        status: "installation-mismatch",
      });
    });

    it("returns installation-mismatch when decryption throws", async () => {
      const { service } = makeService(dbDouble({ projectRows: [PROJECT] }), {
        decrypt: () => {
          throw new Error("malformed encrypted payload");
        },
      });

      await expect(service.handleGithubPush(BODY)).resolves.toEqual({
        status: "installation-mismatch",
      });
    });

    it("returns deduped when a queued run for the same sha exists", async () => {
      const { service, queue } = makeService(
        dbDouble({ projectRows: [PROJECT], dedupRows: [{ id: "existing-run" }] }),
      );

      await expect(service.handleGithubPush(BODY)).resolves.toEqual({
        status: "deduped",
      });
      expect(queue.enqueueRun).not.toHaveBeenCalled();
    });

    it("returns queued + runId and enqueues on success", async () => {
      const { service, queue } = makeService(
        dbDouble({
          projectRows: [PROJECT],
          dedupRows: [],
          insertedRows: [{ id: RUN_ID }],
        }),
      );

      await expect(service.handleGithubPush(BODY)).resolves.toEqual({
        status: "queued",
        runId: RUN_ID,
      });
      expect(queue.enqueueRun).toHaveBeenCalledWith({
        runId: RUN_ID,
        projectId: PROJECT.id,
      });
    });
  });
});