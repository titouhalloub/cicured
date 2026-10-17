import { randomUUID, createCipheriv, randomBytes } from "node:crypto";
import pg from "pg";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const DATABASE_URL = process.env.DATABASE_URL!;
const REDIS_URL = process.env.REDIS_URL!;
const SFT_ENCRYPTION_KEY = process.env.SFT_ENCRYPTION_KEY!;
const QUEUE_NAME = process.env.SFT_QUEUE_NAME ?? "sft-runs";
const INSTALLATION_ID = process.env.SFT_SEED_INSTALLATION_ID ?? "166710597";
const REPO_FULL_NAME = process.env.SFT_SEED_REPO ?? "titouhalloub/cicured";
const BRANCH = process.env.SFT_SEED_BRANCH ?? "main";

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("SFT_ENCRYPTION_KEY must be 32 bytes (base64) or 64-char hex");
}

function encrypt(plaintext: string, rawKey: string): string {
  const key = parseKey(rawKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: redis });

  const userId = randomUUID();
  const projectId = randomUUID();
  const runId = randomUUID();

  await pool.query(
    `INSERT INTO users (id, email, provider, provider_user_id, plan)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, "seed@cicured.local", "github", "seed-" + userId, "free"]
  );

  await pool.query(
    `INSERT INTO projects (id, user_id, provider, repo_full_name, installation_id_enc, default_branch)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [projectId, userId, "github", REPO_FULL_NAME, encrypt(INSTALLATION_ID, SFT_ENCRYPTION_KEY), "main"]
  );

  await pool.query(
    `INSERT INTO runs (id, project_id, sha, branch, trigger, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [runId, projectId, null, BRANCH, "manual", "queued"]
  );

  await queue.add("run", { runId, projectId }, { jobId: runId });

  console.log("SEEDED");
  console.log("  userId    =", userId);
  console.log("  projectId =", projectId);
  console.log("  runId     =", runId);
  console.log("");
  console.log("Watch the worker terminal for progress.");

  await queue.close();
  await redis.quit();
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });