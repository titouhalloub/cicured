import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DEFAULT_RUNNER_HOST_PATH = fileURLToPath(
  new URL("../../../packages/runner/sft-dev.mjs", import.meta.url),
);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SFT_QUEUE_NAME: z.string().min(1).default("sft-runs"),
  SFT_LOG_CHANNEL_PREFIX: z.string().min(1).default("sft:logs:"),
  SFT_ENCRYPTION_KEY: z.string().min(1, "SFT_ENCRYPTION_KEY is required"),
  GITHUB_APP_ID: z.string().min(1, "GITHUB_APP_ID is required"),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1, "GITHUB_APP_PRIVATE_KEY is required"),
  GITHUB_API_BASE: z.string().url().default("https://api.github.com"),
  WEB_APP_URL: z.string().url().default("http://localhost:3000"),
  SANDBOX_IMAGE: z.string().min(1).default("cicured/sandbox:node20"),
  REPORTS_DIR: z.string().min(1).default("./tmp/reports"),
  SFT_TASK_TIMEOUT_MS: z.coerce.number().int().positive().default(600_000),
  SFT_DEADLINE_BUDGET_MS: z.coerce.number().int().positive().default(1_800_000),
  SFT_RUNNER_HOST_PATH: z.string().min(1).default(DEFAULT_RUNNER_HOST_PATH),
  PNPM_STORE_HOST_PATH: z
    .string()
    .min(1)
    .default(path.join(os.homedir(), ".cache", "cicured-pnpm-store")),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1).default("cicured-logs"),

  // LLM suggestion engine. Only the selected provider's key is required at runtime.
  LLM_PROVIDER: z.enum(["anthropic", "openrouter"]).default("anthropic"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
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

export function assertRunnerArtifact(env: WorkerEnv): void {
  if (!existsSync(env.SFT_RUNNER_HOST_PATH)) {
    throw new Error(
      `pinned runner not found at ${env.SFT_RUNNER_HOST_PATH} (set SFT_RUNNER_HOST_PATH)`,
    );
  }
}
