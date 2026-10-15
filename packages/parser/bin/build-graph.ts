#!/usr/bin/env node
/**
 * CLI entry point for the bundled graph builder.
 *
 * This file is the boundary between the sandbox and the parser's analysis core
 * (`packages/parser/src/codegraph`). It:
 *
 *   - resolves the grammar WASM files at startup (npm package, or the sandbox
 *     override `SFT_PARSER_GRAMMARS_DIR` implemented in
 *     `packages/parser/src/graph/walker.ts`);
 *   - builds the {@link CodeGraph} for `<repo-root>`;
 *   - serializes the graph as JSON to stdout, or to `--out-file` when given.
 *
 * Compiled by `pnpm build:graph` into `bin/build-graph.js`.
 */
import { buildCodeGraph } from "../src/codegraph";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const args = process.argv.slice(2);
const outFileIndex = args.indexOf("--out-file");
const outFile = outFileIndex >= 0 ? args[outFileIndex + 1] : undefined;
const positional = args.filter((a) => a !== "--out-file" && a !== "-o");
const rootDir = positional[0];

function printUsage(): void {
  console.error(`usage: node bin/build-graph.ts <repo-root> [--out-file <path>]`);
  console.error(`  <repo-root>   repository to build a graph for`);
  console.error(`  --out-file    also write the graph JSON to this path (relative to <repo-root>)`);
}

async function main(): Promise<void> {
  const grammarDir = process.env.SFT_PARSER_GRAMMARS_DIR;
  if (grammarDir) {
    console.error(`[sft/graph-builder] loading grammar WASM from ${path.resolve(grammarDir)}`);
  }

  if (rootDir === undefined) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const root = path.resolve(rootDir);
  if (!existsSync(root)) {
    console.error(`error: repo root not found: ${root}`);
    process.exitCode = 1;
    return;
  }

  const graph = await buildCodeGraph({ rootDir: root });

  if (outFile) {
    const target = path.resolve(root, outFile);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(graph, null, 2)}\n`, "utf8");
    console.error(`graph written to ${target}`);
    return;
  }

  console.log(JSON.stringify(graph, null, 2));
}

main();
