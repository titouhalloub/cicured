import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LlmCallRecord } from "@sft/schemas";

const LEDGER_DIR = ".sft";
const LEDGER_FILE = "llm-calls.jsonl";

function getLedgerPath(cwd: string): string {
  return path.join(cwd, LEDGER_DIR, LEDGER_FILE);
}

export function appendLlmCall(record: LlmCallRecord, cwd: string = process.cwd()): void {
  try {
    const dir = path.join(cwd, LEDGER_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(getLedgerPath(cwd), JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Never throw on ledger write failure (silent degradation)
  }
}

export function readLlmCalls(cwd: string = process.cwd()): LlmCallRecord[] {
  const p = getLedgerPath(cwd);
  if (!existsSync(p)) return [];
  try {
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LlmCallRecord);
  } catch {
    return [];
  }
}

/**
 * Truncate the ledger after a successful upload (`sft sync` without --keep).
 * Same contract as appendLlmCall: ledger IO never breaks the command.
 */
export function clearLlmCalls(cwd: string = process.cwd()): void {
  try {
    const p = getLedgerPath(cwd);
    if (!existsSync(p)) return;
    writeFileSync(p, "", "utf8");
  } catch {
    // Silent degradation — a stale ledger just re-uploads next time.
  }
}