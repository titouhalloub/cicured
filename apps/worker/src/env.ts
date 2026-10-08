import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * `<repo>/packages/runner/sft-dev.mjs`, resolved from this module's location
 * (apps/worker/src/env.ts) so the worker works from any cwd. Overridable for
 * deployments that keep the artifact elsewhere.
 */
export const DEFAULT_RUNNER_HOST_PATH = fileURLToPath(
  new URL("../../../packages/runner/sft-dev.mjs", import.meta.url),
);

/**
 * Every environment variable the worker reads (Spec §14: ".env.example listing
 * every variable used"). Validation happens once at boot; missing values fail
 * fast with a readable message, mirroring apps/api/src/config/env.ts.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  /** Same queue the API produces into (apps/api/src/queue/queue.module.ts). */
  SFT_QUEUE_NAME: z.string().min(1).default("sft-runs"),
  /** Redis pub/sub channel prefix for live log streaming (M2b-1). */
  SFT_LOG_CHANNEL_PREFIX: z.string().min(1).default("sft:logs:"),

  /** AES-256-GCM key: base64 (32 bytes) or 64-char hex. Same key the API uses. */
  SFT_ENCRYPTION_KEY: z.string().min(1, "SFT_ENCRYPTION_KEY is required"),

  // GitHub App credentials are required by the worker: every run mints an
  // installation token for the clone (Spec §8).
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required"),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1, "GITHUB_APP_PRIVATE_KEY is required"),
  GITHUB_API_BASE: z.string().url().default("https://api.github.com"),

  /** Sandbox image built from docker/sandbox/Dockerfile. */
  SANDBOX_IMAGE: z.string().min(1).default("cicured/sandbox:node20"),
  /** M2a report storage on the worker host. S3 archival is M2b. */
  REPORTS_DIR: z.string().min(1).default("./tmp/reports"),

  /** Per-task cap handed to the runner (runner default is also 10 min). */
  SFT_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  /** Wall-clock budget per run: the container is killed after this. */
  SFT_DEADLINE_BUDGET_MS: z.coerce.number().int().positive().default(900_000),

  /** Host path of the pinned runner, bind-mounted read-only into the sandbox. */
  SFT_RUNNER_HOST_PATH: z.string().min(1).default(DEFAULT_RUNNER_HOST_PATH),

  // ─── S3 / MinIO log archival (M2b-2) ─────────────────────────────────────
  // Same code path for MinIO (local) and AWS S3 (prod). MinIO requires
  // forcePathStyle: true; the endpoint is only set when S3_ENDPOINT is set.
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1).default("cicured-logs"),

   // ─── LLM suggestion engine (M4a) ──────────────────────────────────────────
   // Leave ANTHROPIC_API_KEY unset to disable the suggestion stage entirely.
   LLM_PROVIDER: z.enum(["anthropic"]).default("anthropic"),
   ANTHROPIC_API_KEY: z.string().min(1).optional(),
   LLM_MODEL: z.string().min(1).default("claude-sonnet-4-5"),
   LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.2),
   LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(2000),
   LLM_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
   LLM_FINDINGS_PER_RUN_CAP: z.coerce.number().int().positive().default(50),
});

export type WorkerEnv = z.infer<typeof EnvSchema>;

const REPO_ROOT_MARKER = "pnpm-workspace.yaml";

function findRepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, REPO_ROOT_MARKER))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Loads `.env` from `cwd` and, failing that, from the workspace root (the file
 * documented in README lives at the root, but `pnpm --filter` runs packages
 * with cwd set to the package directory). Never in production. Built-in Node
 * support only - no dotenv dependency. Real process env wins over file values.
 */
export function loadDotEnvFile(cwd: string = process.cwd()): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const candidates = [path.join(cwd, ".env")];
  const repoRoot = findRepoRoot(cwd);
  if (repoRoot) candidates.push(path.join(repoRoot, ".env"));
  const loaded: string[] = [];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      loaded.push(file);
    } catch {
      // A malformed .env must not crash boot; zod reports missing values instead.
    }
  }
  return loaded;
}

/** Validates and returns the typed environment. Throws with every issue listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

/**
 * The pinned runner is bind-mounted into every sandbox, so a wrong host path
 * is a boot-time failure, not a per-run surprise (Spec §2).
 */
export function assertRunnerArtifact(env: WorkerEnv): void {
  if (!existsSync(env.SFT_RUNNER_HOST_PATH)) {
    throw new Error(
      `pinned runner not found at ${env.SFT_RUNNER_HOST_PATH} (set SFT_RUNNER_HOST_PATH)`,
    );
  }
}