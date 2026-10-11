import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendRun, MAX_CACHED_RUNS, readCache, writeCache, type CacheRun } from "../src/storage/cache";

let dir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

function makeRun(overrides: Partial<CacheRun> = {}): CacheRun {
  return {
    id: "run-1",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:04.200Z",
    exitCode: 0,
    summary: { total: 4, passed: 4, failed: 0, skipped: 0 },
    tasks: [{ name: "Type Check", success: true, durationMs: 4200 }],
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sft-cache-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("cache", () => {
  it("round-trips a written cache", () => {
    const cache = { version: 1 as const, runs: [makeRun()] };
    writeCache(cache);
    expect(readCache()).toEqual(cache);
  });

  it("returns an empty cache when the file is missing", () => {
    expect(readCache()).toEqual({ version: 1, runs: [] });
  });

  it("returns an empty cache when the file is corrupt", () => {
    mkdirSync(path.join(dir, ".sft"), { recursive: true });
    writeFileSync(path.join(dir, ".sft", "cache.json"), "{ not json", "utf8");
    expect(readCache()).toEqual({ version: 1, runs: [] });
  });

  it("prepends new runs", () => {
    appendRun(makeRun({ id: "older" }));
    appendRun(makeRun({ id: "newer" }));
    expect(readCache().runs.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("caps history at MAX_CACHED_RUNS keeping the most recent", () => {
    for (let i = 0; i < MAX_CACHED_RUNS + 10; i += 1) {
      appendRun(makeRun({ id: `run-${i}` }));
    }
    const { runs } = readCache();
    expect(runs).toHaveLength(MAX_CACHED_RUNS);
    expect(runs[0]!.id).toBe(`run-${MAX_CACHED_RUNS + 9}`);
    expect(cwdSpy).toHaveBeenCalled();
  });
});
