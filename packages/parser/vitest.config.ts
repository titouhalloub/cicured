import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    // When test.exclude is set it REPLACES vitest's defaults, so the full
    // standard list is spelled out here plus our fixture-repo addition.
    // test/fixtures/** are tiny throwaway repos with their own tsconfigs;
    // their *.spec.ts files must not be picked up as workspace suites.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*",
      "test/fixtures/**",
    ],
    // buildCodeGraph shells out to the TypeScript compiler API and walks a
    // real fixture tree; under `pnpm -r`'s 7-package concurrency on Windows it
    // can exceed vitest's 5s default. Mirrors the runner's budget.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
