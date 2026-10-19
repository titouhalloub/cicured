import type { LlmCallRecord } from "@sft/schemas";
import { readCredentials } from "../storage/credentials";
import { clearLlmCalls, readLlmCalls } from "../storage/ledger";

const DEFAULT_API_URL = "http://localhost:4000";
/** The API accepts at most 1000 records per POST; upload in matching batches. */
const MAX_BATCH = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

/** Ledger record as stored locally — may carry an optional run link. */
interface SyncableRecord extends LlmCallRecord {
  runId?: string;
}

/**
 * `sft sync` — upload the local LLM usage ledger to the API
 * (POST /usage/llm-calls, `Authorization: Bearer <device token>`).
 *
 * On success the ledger is cleared unless `--keep` is passed. On any failure
 * it is kept intact so nothing is lost. The token is never printed or logged,
 * and the API base URL comes from SFT_API_URL (default http://localhost:4000).
 */
export async function syncCommand(
  argv: string[] = [],
  cwd: string = process.cwd(),
): Promise<number> {
  const keep = argv.includes("--keep");

  const credentials = readCredentials();
  if (!credentials) {
    process.stderr.write("Not signed in — run `sft login` first.\n");
    return 1;
  }

  const records = readLlmCalls(cwd) as SyncableRecord[];
  if (records.length === 0) {
    process.stdout.write("Nothing to sync — the local LLM ledger is empty.\n");
    return 0;
  }

  const baseUrl = (process.env.SFT_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
  let synced = 0;
  for (let start = 0; start < records.length; start += MAX_BATCH) {
    const batch = records.slice(start, start + MAX_BATCH);
    if (!(await postBatch(baseUrl, credentials.deviceToken, batch))) {
      process.stderr.write(`Sync failed — ${synced} record(s) uploaded; ledger kept.\n`);
      return 1;
    }
    synced += batch.length;
  }

  if (!keep) clearLlmCalls(cwd);
  process.stdout.write(
    `Synced ${synced} LLM call(s) — ledger ${keep ? "kept" : "cleared"}.\n`,
  );
  return 0;
}

/** POST one batch. Returns false (and explains why) instead of throwing. */
async function postBatch(
  baseUrl: string,
  deviceToken: string,
  records: SyncableRecord[],
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/usage/llm-calls`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ records }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    process.stderr.write(`Sync failed — cannot reach ${baseUrl}: ${message(error)}\n`);
    return false;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    process.stderr.write(
      `Sync failed — HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}\n`,
    );
    return false;
  }
  return true;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
