import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      // Test-only values. Real deployments must provide their own .env.
      SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
      SFT_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://sft:sft@localhost:5432/sft_dev",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
      // Dedicated queue namespace so tests never touch the dev queue.
      SFT_QUEUE_NAME: "sft-runs-test",
      API_PUBLIC_URL: "http://localhost:4000",
      WEB_APP_URL: "http://localhost:3000",
      GITHUB_API_BASE: "https://api.github.com",
      GITHUB_OAUTH_BASE: "https://github.com",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    },
  },
  plugins: [
    // SWC is required: esbuild cannot emit decorator metadata, and NestJS DI
    // relies on design:paramtypes to resolve constructor injection.
    swc.vite({ module: { type: "es6" } }),
  ],
});
