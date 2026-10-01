import { EnvSchema, type WorkerEnv } from "../src/env";

/** Matches the vitest.config.ts test env; no real secrets, no real infra. */
export const TEST_ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/** A syntactically valid, throwaway keypair entry - never used to sign. */
export const TEST_PRIVATE_KEY = [
  "-----BEGIN RSA PRIVATE KEY-----",
  "MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu",
  "KUpRKfFLfRYC9AIKjbJTWit+CqvjWYzvQwECAwEAAQJAIJLixBy2qpFoS4DSmoEm",
  "o3qGy0t6z09AIJtH+5OeRV1be+N4cDYJKffGzDa88vQENZiRm0GRq6a+HPGQMd2k",
  "-----END RSA PRIVATE KEY-----",
].join("\n");

export function makeEnv(overrides: Partial<Record<keyof WorkerEnv, unknown>> = {}): WorkerEnv {
  return EnvSchema.parse({
    DATABASE_URL: "postgres://sft:sft@localhost:5432/sft_dev",
    REDIS_URL: "redis://localhost:6379",
    SFT_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    GITHUB_APP_ID: "123456",
    GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY,
    GITHUB_API_BASE: "https://api.github.com",
    SANDBOX_IMAGE: "cicured/sandbox:node20",
    REPORTS_DIR: "./tmp/test-reports",
    SFT_TASK_TIMEOUT_MS: 600_000,
    SFT_DEADLINE_BUDGET_MS: 900_000,
    SFT_RUNNER_HOST_PATH: "/host/path/packages/runner/sft-dev.mjs",
    ...overrides,
  }) as WorkerEnv;
}