import { createHash } from "node:crypto";
import type { SuggestionDraft } from "@sft/schemas";
import type IORedis from "ioredis";

export interface LlmCache {
  get(key: string): Promise<SuggestionDraft | null>;
  set(key: string, value: SuggestionDraft): Promise<void>;
}

/** Spec §7: components are joined with U+2016 (‖) before the final sha256. */
const DELIMITER = "‖";

export function computeCacheKey(params: {
  model: string;
  promptVersion: string;
  fingerprint: string;
  snippet: string;
}): string {
  // sha256(model‖promptVersion‖fingerprint‖sha256(snippet))
  const model = params.model;
  const promptVersion = params.promptVersion;
  const fingerprint = params.fingerprint;
  const snippet = params.snippet;

  const snippetHash = createHash("sha256").update(snippet).digest("hex");

  const combined = `${model}${DELIMITER}${promptVersion}${DELIMITER}${fingerprint}${DELIMITER}${snippetHash}`;
  const hash = createHash("sha256").update(combined).digest("hex");

  return `llm:cache:v1:${hash}`;
}

export function createLlmCache(redis: IORedis, ttlSeconds: number): LlmCache {
  return {
    async get(key: string): Promise<SuggestionDraft | null> {
      try {
        const raw = await redis.get(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed;
      } catch {
        return null;
      }
    },
    async set(key: string, value: SuggestionDraft): Promise<void> {
      try {
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        // Cache write failure must not affect the pipeline
      }
    },
  };
}
