import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { SESSION_COOKIE_NAME, SessionService } from "../src/auth/session.service";
import { CryptoService } from "../src/common/crypto.service";
import { DRIZZLE, projects, runs, users, type Database } from "../src/db";
import { resolveMigrationsFolder, runMigrations } from "../src/db/migrate";
import { RUNS_QUEUE } from "../src/queue/queue.module";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://sft:sft@localhost:5432/sft_dev";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

function tcpReachable(url: string, defaultPort: number): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    const socket = createConnection({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : defaultPort,
    });
    socket.setTimeout(1500);
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/**
 * Live acceptance test for M1 criterion 2: "Creating a run via the API inserts
 * a `queued` row and a BullMQ job". Requires `docker compose up -d`; it skips
 * itself when Postgres/Redis are unreachable so `pnpm -r test` stays green on
 * machines without infrastructure.
 */
const infraUp = await Promise.all([
  tcpReachable(DATABASE_URL, 5432),
  tcpReachable(REDIS_URL, 6379),
]).then(([pg, redis]) => pg && redis);

describe.skipIf(!infraUp)("runs end-to-end (requires docker compose up -d)", () => {
  let app: INestApplication;
  let db: Database;
  let userId: string;
  let projectId: string;
  let sessionCookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get<Database>(DRIZZLE);
    await runMigrations(db, resolveMigrationsFolder());

    const suffix = randomUUID().slice(0, 8);
    const insertedUsers = await db
      .insert(users)
      .values({
        provider: "github",
        providerUserId: `it-${suffix}`,
        email: `it-${suffix}@example.test`,
      })
      .returning();
    const user = insertedUsers[0];
    if (!user) throw new Error("failed to insert integration-test user");
    userId = user.id;

    const crypto = app.get(CryptoService);
    const insertedProjects = await db
      .insert(projects)
      .values({
        userId: user.id,
        provider: "github",
        repoFullName: `sft-it-${suffix}/sandbox`,
        installationIdEnc: crypto.encrypt("123456"),
        defaultBranch: "main",
      })
      .returning();
    const project = insertedProjects[0];
    if (!project) throw new Error("failed to insert integration-test project");
    projectId = project.id;

    sessionCookie = `${SESSION_COOKIE_NAME}=${app
      .get(SessionService)
      .createSessionToken(user.id)}`;
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    if (userId) await db.delete(users).where(eq(users.id, userId));
    const queue = app.get<Queue>(RUNS_QUEUE);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await app.close();
  }, 30_000);

  it("rejects unauthenticated run creation", async () => {
    await request(app.getHttpServer())
      .post(`/projects/${projectId}/run`)
      .send({})
      .expect(401);
  });

  it("inserts a queued row and a BullMQ job, then serves it back", async () => {
    const created = await request(app.getHttpServer())
      .post(`/projects/${projectId}/run`)
      .set("Cookie", sessionCookie)
      .send({ branch: "main" })
      .expect(202);

    const runId = created.body.id as string;
    expect(created.body.status).toBe("queued");
    expect(created.body.trigger).toBe("manual");

    const rows = await db.select().from(runs).where(eq(runs.id, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("queued");
    expect(rows[0]?.branch).toBe("main");
    expect(rows[0]?.startedAt).toBeNull();

    const queue = app.get<Queue>(RUNS_QUEUE);
    const job = await queue.getJob(runId);
    expect(job).toBeDefined();
    expect(job?.data).toMatchObject({ runId, projectId });

    const fetched = await request(app.getHttpServer())
      .get(`/runs/${runId}`)
      .set("Cookie", sessionCookie)
      .expect(200);
    expect(fetched.body.id).toBe(runId);

    const listed = await request(app.getHttpServer())
      .get(`/projects/${projectId}/runs`)
      .set("Cookie", sessionCookie)
      .expect(200);
    expect(listed.body.total).toBeGreaterThanOrEqual(1);
    const ids = (listed.body.items as Array<{ id: string }>).map((item) => item.id);
    expect(ids).toContain(runId);

    await job?.remove();
  }, 30_000);

  it("reports healthy readiness while infra is up", async () => {
    const ready = await request(app.getHttpServer()).get("/health/ready").expect(200);
    expect(ready.body).toMatchObject({ status: "ok", database: true, redis: true });
  });
});
