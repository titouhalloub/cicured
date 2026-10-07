import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    testTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgres://sft:sft@localhost:5432/sft_dev",
      REDIS_URL: "redis://localhost:6379",
      SFT_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      GITHUB_API_BASE: "https://api.github.com",
      S3_ACCESS_KEY_ID: "test-access-key",
      S3_SECRET_ACCESS_KEY: "test-secret-key",
    },
  },
  plugins: [
    // Same transform as apps/api: SWC, not esbuild. The worker itself is
    // plain TypeScript, but mirroring the API keeps one runner for the monorepo.
    swc.vite({ module: { type: "es6" } }),
  ],
});