import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, expect, it, beforeAll } from "vitest";

/**
 * End-to-end tests for the graph-builder bundle produced by
 * `pnpm build:graph` (`packages/parser/bin/build-graph.ts` plus the wrapper
 * `packages/parser/scripts/build-graph.mjs`).
 *
 * The compiled CLI is run against the parser's own fixtures so that the gate
 * `pnpm -r test` covers the whole workflow: bundle creation, plain graph
 * building, the `SFT_PARSER_GRAMMARS_DIR` flat-directory override and
 * `--out-file` output.
 */
const parserDir = path.resolve(__dirname, "..");
const CLI_PATH = path.resolve(parserDir, "bin", "build-graph.js");
const WRAPPER_PATH = path.resolve(parserDir, "scripts", "build-graph.mjs");
const FIXTURE_DIR = path.resolve(parserDir, "test", "fixtures", "graph-fixture");
const FIXTURE_PYTHON_DIR = path.resolve(parserDir, "test", "fixtures", "graph-fixture-python");

/** The grammar WASM files shipped inside the tree-sitter npm packages. */
const GRAMMAR_WASM: Record<string, string> = {
  typescript: path.resolve(parserDir, "node_modules", "tree-sitter-typescript", "tree-sitter-typescript.wasm"),
  tsx: path.resolve(parserDir, "node_modules", "tree-sitter-typescript", "tree-sitter-tsx.wasm"),
  python: path.resolve(parserDir, "node_modules", "tree-sitter-python", "tree-sitter-python.wasm"),
  go: path.resolve(parserDir, "node_modules", "tree-sitter-go", "tree-sitter-go.wasm"),
  rust: path.resolve(parserDir, "node_modules", "tree-sitter-rust", "tree-sitter-rust.wasm"),
};

function workspaceRoot(): string {
  // `pnpm -r test` runs from the monorepo root, so cwd is already the workspace
  // root. Walk up from the test file until the workspace manifest appears.
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    const manifest = path.resolve(dir, "pnpm-workspace.yaml");
    if (existsSync(manifest)) return dir;
    const pkgPath = path.resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const name = JSON.parse(readFileSync(pkgPath, "utf8")).name;
        if (name !== "@sft/parser") return dir;
      } catch {
        // Unreadable / non-JSON package.json: keep climbing.
      }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function ensureBundle(): void {
  const ws = workspaceRoot();
  const result = spawnSync("pnpm", ["--filter", "@sft/parser", "run", "build:graph"], {
    cwd: ws,
    stdio: "inherit",
    env: process.env,
    // Windows installs pnpm as a .cmd shim, which spawnSync can only launch
    // through the shell; other platforms execute the binary directly.
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  expect(existsSync(CLI_PATH)).toBe(true);
  expect(existsSync(WRAPPER_PATH)).toBe(true);
}

/** Copy every grammar WASM into a fresh flat directory (the sandbox layout). */
function makeGrammarDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sft-grammars-"));
  for (const [name, source] of Object.entries(GRAMMAR_WASM)) {
    writeFileSync(path.join(dir, name), readFileSync(source));
  }
  return dir;
}

function runGraphBuilder(args: string[], env: NodeJS.ProcessEnv = process.env): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `build-graph exited with code ${result.status}: ${result.stderr ?? ""}`,
    );
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("bundled graph-builder CLI", () => {
  beforeAll(() => {
    ensureBundle();
  });

  it("builds the bundle and emits a CodeGraph JSON for a TypeScript fixture", () => {
    const { stdout } = runGraphBuilder([CLI_PATH, FIXTURE_DIR]);

    const graph = JSON.parse(stdout);
    expect(graph.files).toBeDefined();
    expect(graph.files.length).toBeGreaterThan(0);
    expect(graph.files.map((f: { path: string }) => f.path)).toContain("src/a.ts");
    expect(
      graph.files.every((f: { functions: unknown[] }) =>
        Array.isArray(f.functions) && f.functions.length > 0,
      ),
    ).toBe(true);
  });

  it("loads the grammar WASM from the flat directory set by SFT_PARSER_GRAMMARS_DIR", () => {
    const grammarsDir = makeGrammarDir();
    try {
      const env = { ...process.env, SFT_PARSER_GRAMMARS_DIR: grammarsDir };
      const { stdout, stderr } = runGraphBuilder([CLI_PATH, FIXTURE_DIR], env);
      expect(stderr).toContain("[sft/graph-builder] loading grammar WASM from");
      const graph = JSON.parse(stdout);
      expect(graph.files.length).toBeGreaterThan(0);
    } finally {
      rmSync(grammarsDir, { recursive: true, force: true });
    }
  });

  it("honours SFT_PARSER_GRAMMARS_DIR for a Python fixture as well", () => {
    const grammarsDir = makeGrammarDir();
    try {
      const env = { ...process.env, SFT_PARSER_GRAMMARS_DIR: grammarsDir };
      const { stdout, stderr } = runGraphBuilder([CLI_PATH, FIXTURE_PYTHON_DIR], env);
      expect(stderr).toContain("[sft/graph-builder] loading grammar WASM from");
      const graph = JSON.parse(stdout);
      expect(graph.files.length).toBeGreaterThan(0);
    } finally {
      rmSync(grammarsDir, { recursive: true, force: true });
    }
  });

  it("spawns the compiled CLI through the wrapper with the same arguments", () => {
    const { stdout, stderr } = runGraphBuilder([WRAPPER_PATH, FIXTURE_DIR]);
    expect(stderr).toContain("[sft/graph-builder]");
    expect(stdout.startsWith("{")).toBe(true);
  });

  it("writes the graph to --out-file when requested", () => {
    const outFile = path.resolve(FIXTURE_DIR, "graph-out.json");
    rmSync(outFile, { force: true });
    const { stderr } = runGraphBuilder([WRAPPER_PATH, FIXTURE_DIR, "--out-file", outFile]);

    expect(stderr).toContain("graph written to");
    expect(existsSync(outFile)).toBe(true);
    const graph = JSON.parse(readFileSync(outFile, "utf8"));
    expect(graph.files.length).toBeGreaterThan(0);
  });
});
