import { createHash } from "node:crypto";
import type { SuggestionDraft } from "@sft/schemas";
import type IORedis from "ioredis";
import { describe, expect, it } from "vitest";
import { computeCacheKey, createLlmCache } from "../../src/ai/cache";

const BASE = {
  model: "claude-sonnet-4-5",
  promptVersion: "m4a-v1",
  fingerprint: "fp-cache-1",
  snippet: "const x = 1;",
} as const;

const DRAFT: SuggestionDraft = {
  patchDiff: "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n",
  explanation: "fix it",
  confidence: 0.8,
  filesTouched: ["x.ts"],
};

interface RedisOverrides {
  get?: (key: string) => Promise<string | null> | string | null;
  set?: (key: string, value: string, ...args: unknown[]) => Promise<unknown> | unknown;
}

function fakeRedis(overrides: RedisOverrides = {}) {
  const store = new Map<string, string>();
  const calls: { op: string; key: string; args: unknown[] }[] = [];
  const redis = {
    async get(key: string) {
      calls.push({ op: "get", key, args: [] });
      if (overrides.get) return overrides.get(key);
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, ...args: unknown[]) {
      calls.push({ op: "set", key, args: [value, ...args] });
      if (overrides.set) return overrides.set(key, value, ...args);
      store.set(key, value);
      return "OK";
    },
    store,
    calls,
  };
  return redis as typeof redis & IORedis;
}

describe("computeCacheKey (Spec §7 content-addressed cache)", () => {
  it("is deterministic for identical inputs", () => {
    expect(computeCacheKey(BASE)).toBe(computeCacheKey({ ...BASE }));
  });

  it("uses the llm:cache:v1 prefix and a 64-hex-char sha256 suffix", () => {
    const key = computeCacheKey(BASE);
    expect(key.startsWith("llm:cache:v1:")).toBe(true);
    expect(key.slice("llm:cache:v1:".length)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches sha256(model‖promptVersion‖fingerprint‖sha256(snippet))", () => {
    const expected = createHash("sha256")
      .update(
        [
          BASE.model,
          BASE.promptVersion,
          BASE.fingerprint,
          createHash("sha256").update(BASE.snippet).digest("hex"),
        ].join("‖"),
      )
      .digest("hex");
    expect(computeCacheKey(BASE)).toBe(`llm:cache:v1:${expected}`);
  });

  it.each([
    ["model", { model: "other-model" }],
    ["promptVersion", { promptVersion: "m4a-v2" }],
    ["fingerprint", { fingerprint: "fp-cache-2" }],
    ["snippet", { snippet: "const x = 2;" }],
  ])("changes when %s changes", (_field, change) => {
    expect(computeCacheKey({ ...BASE, ...change })).not.toBe(computeCacheKey(BASE));
  });
});

describe("createLlmCache", () => {
  it("returns null on a cache miss", async () => {
    const cache = createLlmCache(fakeRedis(), 3600);
    expect(await cache.get("llm:cache:v1:missing")).toBeNull();
  });

  it("round-trips a draft through Redis JSON", async () => {
    const redis = fakeRedis();
    const cache = createLlmCache(redis, 3600);
    await cache.set("llm:cache:v1:hit", DRAFT);
    expect(await cache.get("llm:cache:v1:hit")).toEqual(DRAFT);
  });

  it("writes with the configured TTL (EX seconds)", async () => {
    const redis = fakeRedis();
    const cache = createLlmCache(redis, 2_592_000);
    await cache.set("llm:cache:v1:ttl", DRAFT);
    const setCall = redis.calls.find((c) => c.op === "set");
    expect(setCall).toBeDefined();
    expect(setCall?.args.slice(1)).toEqual(["EX", 2_592_000]);
  });

  it("treats a corrupt cache entry as a miss instead of throwing", async () => {
    const redis = fakeRedis({ get: () => "{not json" });
    const cache = createLlmCache(redis, 3600);
    expect(await cache.get("llm:cache:v1:corrupt")).toBeNull();
  });

  it("swallows Redis failures on both get and set", async () => {
    const failing = {
      async get() {
        throw new Error("redis down");
      },
      async set() {
        throw new Error("redis down");
      },
    } as unknown as IORedis;
    const cache = createLlmCache(failing, 3600);
    expect(await cache.get("llm:cache:v1:any")).toBeNull();
    await expect(cache.set("llm:cache:v1:any", DRAFT)).resolves.toBeUndefined();
  });
});
