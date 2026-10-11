#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(here, "..", "sft-dev.mjs");
const result = spawnSync(process.execPath, [runner, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
