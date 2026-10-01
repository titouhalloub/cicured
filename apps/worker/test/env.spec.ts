import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertRunnerArtifact, EnvSchema, loadEnv } from "../src/env";

/** Minimal valid worker environment; every field the worker actually reads. */
const VALID = {
  DATABASE_URL: "postgres://sft:sft@localhost:5432/sft_dev",
  SFT_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----",
};

describe("worker env (mirrors apps/api/src/config/env.ts)", () => {
  it("applies the locked M2a defaults", () => {
    const env = EnvSchema.parse(VALID);
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.SFT_QUEUE_NAME).toBe("sft-runs");
    expect(env.GITHUB_API_BASE).toBe("https://api.github.com");
    expect(env.SANDBOX_IMAGE).toBe("cicured/sandbox:node20");
    expect(env.REPORTS_DIR).toBe("./tmp/reports");
    expect(env.SFT_TASK_TIMEOUT_MS).toBe(600_000);
    expect(env.SFT_DEADLINE_BUDGET_MS).toBe(900_000);
  });

  it("defaults the runner mount to the pinned artifact", () => {
    const env = EnvSchema.parse(VALID);
    expect(env.SFT_RUNNER_HOST_PATH).toMatch(/packages[/\\]runner[/\\]sft-dev\.mjs$/);
  });

  it("reports every missing required variable at once", () => {
    const source = { ...process.env };
    for (const key of Object.keys(VALID)) delete source[key];

    let message = "";
    try {
      loadEnv(source);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("invalid environment configuration");
    for (const key of Object.keys(VALID)) {
      expect(message).toContain(key);
    }
  });

  it("fails fast when the pinned runner is missing on the host", async () => {
    const env = EnvSchema.parse({ ...VALID, SFT_RUNNER_HOST_PATH: "/nope/sft-dev.mjs" });
    expect(() => assertRunnerArtifact(env)).toThrow(/pinned runner not found/);

    const dir = await mkdtemp(path.join(tmpdir(), "sft-runner-"));
    const file = path.join(dir, "sft-dev.mjs");
    await writeFile(file, "// pinned\n");
    expect(() => assertRunnerArtifact(EnvSchema.parse({ ...VALID, SFT_RUNNER_HOST_PATH: file }))).not.toThrow();
  });
});