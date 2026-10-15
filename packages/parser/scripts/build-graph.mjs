#!/usr/bin/env node
/**
 * Bundled graph-builder runner.
 *
 * This is the entry point that `pnpm build:graph` invokes inside a sandbox. It:
 *
 *   1. prints a one-line header with the parser package version, the worktree
 *      git SHA and the bundle built-at timestamp;
 *   2. spawns the compiled CLI (`bin/build-graph.js`) with the same arguments
 *      and forwards its exit code.
 *
 * The compiled CLI is the analysis core (`packages/parser/src/codegraph`) and
 * loads the grammar WASM files from the npm packages, or from the flat
 * directory supplied through `SFT_PARSER_GRAMMARS_DIR` (see
 * `packages/parser/src/graph/walker.ts`).
 *
 * Usage:
 *   node scripts/build-graph.mjs <repo-root> [--out-file <path>]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const selfDir = path.dirname(fileURLToPath(import.meta.url));
// scripts/ → (..) → parser/ → (..) → packages/ → (..) → monorepo root, then into
// packages/parser/ (three levels up plus the two known directories).
const monorepoRoot = path.resolve(selfDir, "..", "..", "..");
const packagesParserDir = path.resolve(monorepoRoot, "packages", "parser");
const packageJsonPath = path.resolve(packagesParserDir, "package.json");
const cliPath = path.resolve(packagesParserDir, "bin", "build-graph.js");
const args = process.argv.slice(2);

/** Read the parser package version from its own package.json. */
function packageVersion() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
}

/** Best-effort git describe of the parser worktree (falls back to "unknown"). */
function worktreeSha(cwd) {
  try {
    const result = spawnSync("git", ["describe", "--always", "--dirty", "--no-renames"], {
      cwd,
      encoding: "utf8",
    });
    return (result.stdout || "").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/** Print the bundle header, then run the compiled CLI, forwarding its exit code.
 *
 * The wrapper is the entry point for the bundle lifecycle: with no arguments it
 * only prints the header (the bundle is fully compiled and ready). With
 * arguments it runs the compiled CLI (`bin/build-graph.js`) the same way and
 * forwards its exit code.
 */
function main() {
  const version = packageVersion();
  const sha = worktreeSha(packagesParserDir);
  const builtAt = new Date().toISOString();
  console.error(`[sft/graph-builder] parser@${version} sha=${sha} builtAt=${builtAt}`);

  if (args.length === 0) {
    return;
  }

  if (!existsSync(cliPath)) {
    console.error(`error: bundled CLI not found: ${cliPath}`);
    console.error("Run 'pnpm build:graph' in packages/parser first.");
    process.exitCode = 1;
    return;
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], {
    stdio: "inherit",
    cwd: packagesParserDir,
  });

  if (result.error) {
    console.error(`error: failed to spawn bundled CLI: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.status !== null) {
    process.exitCode = result.status;
  }
}

main();
