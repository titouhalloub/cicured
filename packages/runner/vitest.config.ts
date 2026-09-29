import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // Every test spawns the real pinned runner as a child process.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
