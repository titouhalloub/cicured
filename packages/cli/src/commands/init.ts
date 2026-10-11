import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const CONFIG_TEMPLATE = `{
  "tasks": [
    { "name": "Type Check", "command": "tsc --noEmit" },
    { "name": "Lint",       "command": "eslint ." },
    { "name": "Build",      "command": "npm run build" },
    { "name": "Tests",      "command": "npm test -- --passWithNoTests" }
  ]
}
`;

/** Writes a starter `sft-dev.config.json` when one is not already present. */
export function initCommand(): number {
  const target = path.join(process.cwd(), "sft-dev.config.json");
  if (existsSync(target)) {
    process.stdout.write("Already exists.\n");
    return 1;
  }

  writeFileSync(target, CONFIG_TEMPLATE, "utf8");
  process.stdout.write("Wrote sft-dev.config.json\n");
  return 0;
}
