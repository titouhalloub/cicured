import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const VALID = {
  DATABASE_URL: "postgres://sft:sft@localhost:5432/sft_dev",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  SFT_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
};

describe("loadEnv (Spec §14: fail fast on bad config)", () => {
  it("applies defaults for optional values", () => {
    const env = loadEnv({ ...VALID });
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(4000);
    expect(env.WEB_APP_URL).toBe("http://localhost:3000");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
    expect(env.SFT_QUEUE_NAME).toBe("sft-runs");
    expect(env.SESSION_TTL_HOURS).toBe(168);
    expect(env.GITHUB_API_BASE).toBe("https://api.github.com");
  });

  it("coerces numeric strings", () => {
    const env = loadEnv({ ...VALID, API_PORT: "4100", SESSION_TTL_HOURS: "24" });
    expect(env.API_PORT).toBe(4100);
    expect(env.SESSION_TTL_HOURS).toBe(24);
  });

  it("lists every missing/invalid variable in one error", () => {
    try {
      loadEnv({ SESSION_SECRET: "short" });
      expect.unreachable("loadEnv should have thrown");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("invalid environment configuration");
      expect(message).toContain("DATABASE_URL");
      expect(message).toContain("SFT_ENCRYPTION_KEY");
      expect(message).toContain("SESSION_SECRET");
    }
  });

  it("rejects a weak SESSION_SECRET", () => {
    expect(() => loadEnv({ ...VALID, SESSION_SECRET: "too-short" })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it("leaves GitHub optional for M1 boot", () => {
    const env = loadEnv({ ...VALID });
    expect(env.GITHUB_CLIENT_ID).toBeUndefined();
    expect(env.GITHUB_APP_ID).toBeUndefined();
  });
});
