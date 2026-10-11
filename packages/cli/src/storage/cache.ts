import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** How many runs are retained locally. Older entries are dropped. */
export const MAX_CACHED_RUNS = 50;

export interface CacheTask {
  name: string;
  success: boolean;
  durationMs: number;
}

export interface CacheRun {
  id: string;
  startedAt: string;
  finishedAt: string;
  exitCode: 0 | 1 | 2;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  tasks: CacheTask[];
}

export interface Cache {
  version: 1;
  runs: CacheRun[];
}

export function cachePath(): string {
  return path.join(process.cwd(), ".sft", "cache.json");
}

function emptyCache(): Cache {
  return { version: 1, runs: [] };
}

// Structural check rather than a zod parse: the cache is machine-owned, and a
// wrong-but-shaped entry should not be silently rewritten as "corrupt".
function isCache(value: unknown): value is Cache {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; runs?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.runs);
}

export function readCache(): Cache {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(), "utf8"));
    return isCache(parsed) ? parsed : emptyCache();
  } catch {
    // Missing file, unreadable file, invalid JSON, or wrong shape.
    return emptyCache();
  }
}

export function writeCache(cache: Cache): void {
  mkdirSync(path.dirname(cachePath()), { recursive: true });
  writeFileSync(cachePath(), `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function appendRun(run: CacheRun): void {
  const runs = [run, ...readCache().runs].slice(0, MAX_CACHED_RUNS);
  writeCache({ version: 1, runs });
}
