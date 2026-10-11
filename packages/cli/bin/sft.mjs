#!/usr/bin/env node
// Thin shim: loads the CLI entry via tsx when running from source,
// or runs the built output when published. For Phase 2 we run from source.
//
// We spawn tsx's JS entry with process.execPath rather than the .bin/tsx(.cmd)
// wrapper: on Windows the wrapper is a .cmd file, and spawning a .cmd without
// shell:true throws EINVAL on Node >=18.20/20.12. Running the JS entry keeps
// this cross-platform with no shell and no swallowed output.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "src", "index.ts");

const tsxCandidates = [
  path.join(here, "..", "node_modules", "tsx", "dist", "cli.mjs"),
  path.join(here, "..", "..", "..", "node_modules", "tsx", "dist", "cli.mjs"),
];
const tsxEntry = tsxCandidates.find((c) => fs.existsSync(c));
if (!tsxEntry) {
  process.stderr.write(
    "sft: could not locate tsx. Run `pnpm install` in the repo.\n",
  );
  process.exit(127);
}

const result = spawnSync(process.execPath, [tsxEntry, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

// status is null when the child was killed by a signal or failed to spawn.
if (result.error) {
  process.stderr.write(`sft: failed to start: ${result.error.message}\n`);
  process.exit(127);
}
process.exit(result.status ?? 1);