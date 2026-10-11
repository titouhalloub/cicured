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
  },
});
