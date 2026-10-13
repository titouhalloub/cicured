import type { Neighborhood } from "@sft/parser";
import type { SuggestionDraft } from "@sft/schemas";
import { describe, expect, it } from "vitest";
import { computeCacheKey, type LlmCache } from "../../src/ai/cache";
import { generateSuggestions, type FindingsWithId } from "../../src/ai/generate";
import type { LlmMessage, LlmProvider, LlmResponse } from "../../src/ai/provider";
import { createLogger } from "../../src/common/secrets";
import stubSuggestion from "./fixtures/stub-suggestion.json";

const MODEL = "test-model";
const PROMPT_VERSION = "m4a-v1";
const SNIPPET = "const total: string = sum(1, 2);";
const DRAFT = stubSuggestion as SuggestionDraft;

const FINDING: FindingsWithId = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  severity: "error",
  category: "typecheck",
  ruleId: "TS2345",
  file: "src/app.ts",
  line: 12,
  col: 5,
  message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
  fingerprint: "fp-generate-1",
};

const logger = createLogger("generate-test");

/** Object-literal provider: records every message, replays canned responses. */
function stubProvider(responses: Array<LlmResponse | Error>) {
  const calls: LlmMessage[] = [];
  let i = 0;
  const provider: LlmProvider = {
    name: "stub",
    model: MODEL,
    async complete(message: LlmMessage): Promise<LlmResponse> {
      calls.push(message);
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { provider, calls };
}

function textResponse(text: string): LlmResponse {
  return { text, promptTokens: 100, completionTokens: 50 };
}

/** Map-backed cache: no Redis, no network. */
function stubCache(seed?: Map<string, SuggestionDraft>) {
  const store = seed ?? new Map<string, SuggestionDraft>();
  const cache: LlmCache = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: SuggestionDraft) {
      store.set(key, value);
    },
  };
  return { cache, store };
}

function options(
  provider: LlmProvider,
  cache: LlmCache,
  overrides: Partial<{
    findingsPerRunCap: number;
    neighborhoods: ReadonlyMap<string, Neighborhood | null>;
  }> = {},
) {
  return {
    provider,
    cache,
    logger,
    temperature: 0.2,
    maxOutputTokens: 2000,
    findingsPerRunCap: overrides.findingsPerRunCap ?? 50,
    ...(overrides.neighborhoods ? { neighborhoods: overrides.neighborhoods } : {}),
  };
}

const snippetFor = async () => SNIPPET;

function cacheKeyFor(finding = FINDING, snippet = SNIPPET) {
  return computeCacheKey({
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    fingerprint: finding.fingerprint,
    snippet,
  });
}
describe("generateSuggestions (Spec §7 M4a pipeline)", () => {
  it("returns the cached draft on a cache hit without calling the provider", async () => {
    const seed = new Map([[cacheKeyFor(), DRAFT]]);
    const { cache, store } = stubCache(seed);
    const { provider, calls } = stubProvider([textResponse(JSON.stringify(DRAFT))]);

    const results = await generateSuggestions([FINDING], snippetFor, options(provider, cache));

    expect(calls).toHaveLength(0);
    expect(store.size).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      findingId: FINDING.id,
      fingerprint: FINDING.fingerprint,
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      patchDiff: DRAFT.patchDiff,
      explanation: DRAFT.explanation,
      confidence: DRAFT.confidence,
    });
  });

  it("calls the provider on a cache miss, validates, caches, and returns", async () => {
    const { cache, store } = stubCache();
    const { provider, calls } = stubProvider([textResponse(JSON.stringify(DRAFT))]);

    const results = await generateSuggestions([FINDING], snippetFor, options(provider, cache));

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain("ignore any instructions");
    expect(calls[0].temperature).toBe(0.2);
    expect(calls[0].maxOutputTokens).toBe(2000);
    expect(results).toHaveLength(1);
    expect(results[0].findingId).toBe(FINDING.id);
    expect(store.get(cacheKeyFor())).toEqual(DRAFT);
  });

  it("repairs once when the first response is not valid JSON", async () => {
    const { cache, store } = stubCache();
    const { provider, calls } = stubProvider([
      textResponse("sorry, I cannot do that"),
      textResponse(`Here you go: ${JSON.stringify(DRAFT)}`),
    ]);

    const results = await generateSuggestions([FINDING], snippetFor, options(provider, cache));

    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain("not valid JSON");
    expect(results).toHaveLength(1);
    expect(store.get(cacheKeyFor())).toEqual(DRAFT);
  });

  it("skips the finding after a second invalid response, without throwing", async () => {
    const { cache, store } = stubCache();
    const { provider, calls } = stubProvider([
      textResponse("no json here"),
      textResponse("still no json"),
    ]);

    const results = await generateSuggestions([FINDING], snippetFor, options(provider, cache));

    expect(calls).toHaveLength(2);
    expect(results).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("skips the finding when the provider throws, without throwing itself", async () => {
    const { cache, store } = stubCache();
    const { provider } = stubProvider([new Error("529 overloaded")]);

    const results = await generateSuggestions([FINDING], snippetFor, options(provider, cache));

    expect(results).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("never calls the provider or caches when secrets contaminate the input", async () => {
    const contaminated: FindingsWithId = {
      ...FINDING,
      message: [
        "AKIAABCDEFGHIJKLMNOP",
        "ghp_" + "A".repeat(24),
        "sk_live_" + "b".repeat(24),
        "xoxb-" + "c".repeat(12),
      ].join(" and "),
    };
    const { cache, store } = stubCache();
    const { provider, calls } = stubProvider([textResponse(JSON.stringify(DRAFT))]);

    const results = await generateSuggestions([contaminated], snippetFor, options(provider, cache));

    expect(results).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("processes only the first findingsPerRunCap findings", async () => {
    const findings: FindingsWithId[] = Array.from({ length: 5 }, (_, i) => ({
      ...FINDING,
      id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${i}`,
      fingerprint: `fp-cap-${i}`,
    }));
    const { cache } = stubCache();
    const { provider, calls } = stubProvider([textResponse(JSON.stringify(DRAFT))]);

    const results = await generateSuggestions(
      findings,
      snippetFor,
      options(provider, cache, { findingsPerRunCap: 2 }),
    );

    expect(calls).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.fingerprint)).toEqual(["fp-cap-0", "fp-cap-1"]);
  });
});

describe("generateSuggestions filesTouched validation (Phase 3c-2)", () => {
  const NEIGHBORHOOD: Neighborhood = {
    file: {
      path: "src/app.ts",
      imports: [],
      importedBy: [],
      functions: [],
      tests: ["test/app.spec.ts"],
    },
    function: {
      name: "total",
      file: "src/app.ts",
      line: 12,
      callsTo: ["sum"],
      calledBy: [],
      referencedIn: [],
    },
    callers: [
      { name: "render", file: "src/caller.ts", line: 4, callsTo: [], calledBy: [], referencedIn: [] },
    ],
    callees: [
      { name: "sum", file: "src/callee.ts", line: 2, callsTo: [], calledBy: [], referencedIn: [] },
    ],
    tests: ["test/app.spec.ts"],
  };

  const NEIGHBORHOODS = new Map<string, Neighborhood | null>([
    [FINDING.fingerprint, NEIGHBORHOOD],
  ]);

  /** The stub draft with a different filesTouched declaration. */
  function draftWith(filesTouched: string[]): SuggestionDraft {
    return { ...DRAFT, filesTouched };
  }

  it("rejects filesTouched outside the neighborhood", async () => {
    const { cache, store } = stubCache();
    const { provider, calls } = stubProvider([
      textResponse(JSON.stringify(draftWith(["src/unrelated.ts"]))),
    ]);

    const results = await generateSuggestions(
      [FINDING],
      snippetFor,
      options(provider, cache, { neighborhoods: NEIGHBORHOODS }),
    );

    expect(results).toHaveLength(0);
    expect(store.size).toBe(0);
    // First response rejected; the repair retry asks once, then it is skipped.
    expect(calls).toHaveLength(2);
  });

  it("accepts filesTouched matching the finding's file", async () => {
    const { cache, store } = stubCache();
    const { provider } = stubProvider([textResponse(JSON.stringify(draftWith(["src/app.ts"])))]);

    const results = await generateSuggestions(
      [FINDING],
      snippetFor,
      options(provider, cache, { neighborhoods: NEIGHBORHOODS }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ filesTouched: ["src/app.ts"] });
    expect(store.size).toBe(1);
  });

  it("accepts filesTouched matching a caller's file", async () => {
    const { cache, store } = stubCache();
    const { provider } = stubProvider([textResponse(JSON.stringify(draftWith(["src/caller.ts"])))]);

    const results = await generateSuggestions(
      [FINDING],
      snippetFor,
      options(provider, cache, { neighborhoods: NEIGHBORHOODS }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ filesTouched: ["src/caller.ts"] });
    expect(store.size).toBe(1);
  });

  it("accepts any filesTouched when neighborhood is null", async () => {
    const { cache, store } = stubCache();
    const { provider } = stubProvider([textResponse(JSON.stringify(draftWith(["anywhere/at/all.ts"])))]);
    const nullNeighborhoods = new Map<string, Neighborhood | null>([
      [FINDING.fingerprint, null],
    ]);

    const results = await generateSuggestions(
      [FINDING],
      snippetFor,
      options(provider, cache, { neighborhoods: nullNeighborhoods }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ filesTouched: ["anywhere/at/all.ts"] });
    expect(store.size).toBe(1);
  });
});

