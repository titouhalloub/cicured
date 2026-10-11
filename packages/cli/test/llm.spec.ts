import type { Neighborhood } from "@sft/parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAnthropicMessages, suggestFix, type SuggestInput } from "../src/llm";

const NEIGHBORHOOD: Neighborhood = {
  file: {
    path: "src/auth.ts",
    imports: [],
    importedBy: [],
    functions: [],
    tests: ["test/auth.test.ts"],
  },
  function: {
    name: "login",
    file: "src/auth.ts",
    line: 40,
    callsTo: [],
    calledBy: ["handleLogin"],
    referencedIn: [],
  },
  callers: [
    {
      name: "handleLogin",
      file: "src/routes.ts",
      line: 10,
      callsTo: [],
      calledBy: [],
      referencedIn: [],
    },
  ],
  callees: [],
  tests: ["test/auth.test.ts"],
};

const INPUT: SuggestInput = {
  ruleId: "TS2339",
  file: "src/auth.ts",
  line: 42,
  message: "Property 'x' does not exist",
  snippet: "const x = 1;",
  neighborhood: NEIGHBORHOOD,
};

/** Stubs global fetch with a valid model response touching the given files. */
function stubModelResponse(filesTouched: string[]): void {
  const payload = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          patchDiff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -42 +42 @@\n-old\n+new",
          explanation: "Fix applied.",
          confidence: 0.9,
          filesTouched,
        }),
      },
    ],
  };
  const response = {
    ok: true,
    status: 200,
    json: async (): Promise<unknown> => payload,
    text: async (): Promise<string> => JSON.stringify(payload),
  };
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suggestFix filesTouched validation", () => {
  it("throws when the model returns filesTouched outside the neighborhood", async () => {
    stubModelResponse(["src/unrelated.ts"]);
    await expect(suggestFix(INPUT, { apiKey: "test-key" })).rejects.toThrow(
      "filesTouched outside neighborhood: src/unrelated.ts",
    );
  });

  it("accepts filesTouched that matches the finding's file", async () => {
    stubModelResponse(["src/auth.ts"]);
    await expect(suggestFix(INPUT, { apiKey: "test-key" })).resolves.toMatchObject({
      filesTouched: ["src/auth.ts"],
    });
  });

  it("accepts filesTouched that matches a caller's file", async () => {
    stubModelResponse(["src/routes.ts"]);
    await expect(suggestFix(INPUT, { apiKey: "test-key" })).resolves.toMatchObject({
      patchDiff: expect.stringContaining("@@"),
    });
  });

  it("accepts any filesTouched when neighborhood is null", async () => {
    stubModelResponse(["anywhere/at/all.ts"]);
    await expect(
      suggestFix({ ...INPUT, neighborhood: null }, { apiKey: "test-key" }),
    ).resolves.toMatchObject({ filesTouched: ["anywhere/at/all.ts"] });
  });
});

describe("buildAnthropicMessages", () => {
  it("includes <codegraph_neighborhood> when a neighborhood is provided", () => {
    const { user } = buildAnthropicMessages(INPUT, "suggest");
    expect(user).toContain("<codegraph_neighborhood>");
    expect(user).toContain("File: src/auth.ts");
    expect(user).toContain("Called by:");
    expect(user).toContain("Tests that import this file:");
  });

  it("omits <codegraph_neighborhood> when neighborhood is null", () => {
    const { user } = buildAnthropicMessages({ ...INPUT, neighborhood: null }, "suggest");
    expect(user).not.toContain("<codegraph_neighborhood>");
  });
});
