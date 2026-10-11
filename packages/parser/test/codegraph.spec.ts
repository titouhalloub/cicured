import * as os from "node:os";
import * as path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  blastRadiusFor,
  buildCodeGraph,
  findFunction,
  readCachedGraph,
  writeCachedGraph,
} from "../src/index";

const FIXTURE = path.join(__dirname, "fixtures", "graph-fixture");

describe("buildCodeGraph", () => {
  it("builds a graph with all source files", async () => {
    const graph = await buildCodeGraph({ rootDir: FIXTURE });

    expect(graph.version).toBe(1);
    expect(graph.files.length).toBeGreaterThanOrEqual(3);
    for (const file of graph.files) {
      expect(path.isAbsolute(file.path)).toBe(false);
    }
  });

  it("detects import edges", async () => {
    const graph = await buildCodeGraph({ rootDir: FIXTURE });
    const a = graph.files.find((f) => f.path === "src/a.ts");

    expect(a).toBeDefined();
    expect(a?.imports.some((i) => i.endsWith("/b.ts"))).toBe(true);
  });

  it("detects caller edges for a known function", async () => {
    const graph = await buildCodeGraph({ rootDir: FIXTURE });

    const [functionB] = findFunction(graph, "functionB");
    expect(functionB).toBeDefined();
    expect(functionB?.calledBy).toContain("functionA");

    const [functionA] = findFunction(graph, "functionA");
    expect(functionA).toBeDefined();
    expect(functionA?.callsTo).toContain("functionB");
  });

  it("detects test files that import a source file", async () => {
    const graph = await buildCodeGraph({ rootDir: FIXTURE });
    const a = graph.files.find((f) => f.path === "src/a.ts");

    expect(a?.tests.some((t) => t.endsWith("test/a.spec.ts"))).toBe(true);
  });

  it("respects exclude patterns", async () => {
    const graph = await buildCodeGraph({
      rootDir: FIXTURE,
      excludePatterns: ["**/src/b.ts"],
    });

    expect(graph.files.some((f) => f.path.endsWith("src/b.ts"))).toBe(false);
  });

  it("returns empty graph on unreadable input without throwing", async () => {
    const graph = await buildCodeGraph({
      rootDir: path.join(FIXTURE, "does-not-exist"),
    });

    expect(graph.files).toHaveLength(0);
    expect(graph.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe("graph cache", () => {
  const tmpRoots: string[] = [];

  afterAll(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
  });

  it("caches to .sft/graph.json and reuses when SHA matches", async () => {
    const cacheRoot = mkdtempSync(path.join(os.tmpdir(), "sft-graph-cache-"));
    tmpRoots.push(cacheRoot);

    const graph = await buildCodeGraph({ rootDir: FIXTURE });
    await writeCachedGraph(cacheRoot, graph);

    const hit = await readCachedGraph(cacheRoot, graph.gitSha);
    expect(hit).not.toBeNull();
    expect(hit?.files).toHaveLength(graph.files.length);

    const miss = await readCachedGraph(cacheRoot, "0".repeat(40));
    expect(miss).toBeNull();
  });
});

describe("blastRadiusFor", () => {
  it("returns callers and tests for a known finding", async () => {
    const graph = await buildCodeGraph({ rootDir: FIXTURE });

    const neighborhood = blastRadiusFor(graph, { file: "src/a.ts", line: 3 });

    expect(neighborhood).not.toBeNull();
    expect(neighborhood?.tests.some((t) => t.endsWith("test/a.spec.ts"))).toBe(
      true,
    );
    expect(neighborhood?.callers.length).toBeGreaterThanOrEqual(1);
  });
});
