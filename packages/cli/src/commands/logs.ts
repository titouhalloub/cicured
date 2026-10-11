import { readCache } from "../storage/cache";

function parseLimit(args: string[]): number {
  const idx = args.indexOf("--limit");
  if (idx === -1) return 10;
  const raw = args[idx + 1];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return parsed;
}

/** Prints the locally cached run history. Never throws. */
export function logsCommand(args: string[]): number {
  const limit = parseLimit(args);
  const { runs } = readCache();

  if (runs.length === 0) {
    process.stdout.write("No local runs yet. Try `sft run`.\n");
    return 0;
  }

  for (const run of runs.slice(0, limit)) {
    const started = Date.parse(run.startedAt);
    const finished = Date.parse(run.finishedAt);
    const durationMs =
      Number.isFinite(started) && Number.isFinite(finished)
        ? Math.max(0, finished - started)
        : 0;
    process.stdout.write(
      `${run.finishedAt}  exit=${run.exitCode}  ${run.summary.passed}/${run.summary.total}  ${durationMs}ms\n`,
    );
  }

  return 0;
}
