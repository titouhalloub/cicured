import { AppConfig } from "../src/config/app-config.service";
import { EnvSchema, type AppEnv } from "../src/config/env";

/** Valid env for unit tests; no real secrets, no real infrastructure. */
export function makeEnv(overrides: Partial<Record<keyof AppEnv, unknown>> = {}): AppEnv {
  const base = EnvSchema.parse({
    DATABASE_URL: "postgres://sft:sft@localhost:5432/sft_dev",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "unit-test-session-secret-0123456789abcdef",
    SFT_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  return { ...base, ...overrides } as AppEnv;
}

export function makeConfig(overrides: Partial<Record<keyof AppEnv, unknown>> = {}): AppConfig {
  return new AppConfig(makeEnv(overrides));
}
