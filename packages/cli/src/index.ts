import { pathToFileURL } from "node:url";
import { graphCommand } from "./commands/graph";
import { initCommand } from "./commands/init";
import { logsCommand } from "./commands/logs";
import { loginCommand } from "./commands/login";
import { runCommand } from "./commands/run";
import { suggestCommand } from "./commands/suggest";
import { syncCommand } from "./commands/sync";
import { CLI_VERSION } from "./version";

const USAGE = `sft — local build runner with optional AI fixes

Usage:
  sft run [--json] [--no-cache]   Run the build pipeline
  sft logs [--limit N]            Show recent local runs (default 10)
  sft init                        Write a sft-dev.config.json template
  sft suggest                     Ask Claude to fix the last failure (BYOK)
  sft graph [--json]              Build a code graph of the current repo
  sft login                       Sign in to cicured.com (coming soon)
  sft sync                        Upload local history (coming soon)
  sft --version                   Print version`;

async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === "--version" || command === "-v") {
    process.stdout.write(`${CLI_VERSION}\n`);
    return 0;
  }

  switch (command) {
    case "run":
      return runCommand(rest);
    case "logs":
      return logsCommand(rest);
    case "init":
      return initCommand();
    case "suggest":
      return suggestCommand(rest);
    case "graph":
      return graphCommand(rest);
    case "login":
      return loginCommand();
    case "sync":
      return syncCommand();
    default:
      process.stderr.write(`Unknown command: ${command}. Try \`sft --help\`.\n`);
      return 2;
  }
}

/** CLI entry point. Resolves the exit code and terminates the process. */
export async function main(): Promise<void> {
  const code = await dispatch(process.argv.slice(2));
  process.exit(code);
}

// Run directly (`tsx src/index.ts`, `node bin/sft.mjs`) rather than imported.
// pathToFileURL() normalises to `file:///C:/...` on Windows; a raw
// `file://${process.argv[1]}` string comparison never matches there because
// argv[1] keeps backslashes and lacks the third slash.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
