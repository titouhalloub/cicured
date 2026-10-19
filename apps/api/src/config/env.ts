import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Every environment variable the API reads (Spec §14: ".env.example listing
 * every variable used"). Validation happens once at boot; missing required
 * values fail fast with a readable message.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  WEB_APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  SFT_QUEUE_NAME: z.string().min(1).default("sft-runs"),
  /** Redis pub/sub channel prefix for live log streaming (M2b-1). Must match
   *  the worker's SFT_LOG_CHANNEL_PREFIX. */
  SFT_LOG_CHANNEL_PREFIX: z.string().min(1).default("sft:logs:"),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),

  /** AES-256-GCM key: base64 (32 bytes) or 64-char hex. See src/common/crypto.ts. */
  SFT_ENCRYPTION_KEY: z.string().min(1, "SFT_ENCRYPTION_KEY is required"),

  /**
   * DEV-MODE auth for the CLI ledger upload (POST /usage/llm-calls).
   * When both are set, the API accepts `Authorization: Bearer <token>` and
   * resolves the user by SFT_DEVICE_TOKEN_EMAIL. Pre-launch stand-in for a
   * real device-token flow; intentionally plain strings so blank values in a
   * copied `.env.example` boot instead of failing validation (an empty value
   * means "not configured" to the guard).
   */
  SFT_DEVICE_TOKEN: z.string().optional(),
  SFT_DEVICE_TOKEN_EMAIL: z.string().optional(),

  // GitHub is optional for M1 boot; endpoints that need it fail with 503 when unset.
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).optional(),
  GITHUB_API_BASE: z.string().url().default("https://api.github.com"),
  GITHUB_OAUTH_BASE: z.string().url().default("https://github.com"),

  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1).default("cicured-logs"),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

/**
 * Loads `.env` from `cwd` when present (never in production). Built-in Node
 * support only - no dotenv dependency. Real process env wins over file values.
 */
export function loadDotEnvFile(cwd: string = process.cwd()): void {
  if (process.env.NODE_ENV === "production") return;
  const file = path.join(cwd, ".env");
  if (!existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch {
    // A malformed .env must not crash boot; zod reports missing values instead.
  }
}

/** Validates and returns the typed environment. Throws with every issue listed. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
