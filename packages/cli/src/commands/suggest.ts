import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Namespace import, not a named one: @sft/schemas has no "type": "module"
// and no exports map, so Node's native ESM loader (via tsx) reads it as CJS
// and cjs-module-lexer cannot statically resolve the barrel `export *` chain.
// A namespace import exposes the detected exports at runtime.
import * as schemas from "@sft/schemas";
import type { SftReportV2 } from "@sft/schemas";
import { computeCostUsd, createProvider, suggestFix } from "../llm";
import { appendLlmCall } from "../storage/ledger";
import { banner, fail } from "../ui";

/** Hard cap on the failure output forwarded to the model. */
const MAX_OUTPUT_BYTES = 10 * 1024;
const MAX_OUTPUT_LINES = 100;
const MAX_MESSAGE_CHARS = 500;

/** Concatenates every failed task's stdout/stderr, capped by bytes and lines. */
function collectFailedOutput(report: SftReportV2): string {
  const lines: string[] = [];
  let bytes = 0;

  for (const task of report.tasks) {
    if (task.success) continue;
    for (const line of `${task.stdout}\n${task.stderr}`.split("\n")) {
      if (lines.length >= MAX_OUTPUT_LINES) break;
      const size = Buffer.byteLength(`${line}\n`, "utf8");
      if (bytes + size > MAX_OUTPUT_BYTES) break;
      bytes += size;
      lines.push(line);
    }
  }

  return lines.join("\n");
}

/**
 * Asks the model for a fix for the most recent failure. BYOK — the caller
 * supplies ANTHROPIC_API_KEY. Never throws.
 */
export async function suggestCommand(_args: string[]): Promise<number> {
  const reportPath = path.join(process.cwd(), "sft-report.json");
  if (!existsSync(reportPath)) {
    process.stderr.write("No sft-report.json — run `sft run` first.\n");
    return 1;
  }

  const parsed = schemas.parseSftReport(readFileSync(reportPath, "utf8"));
  if (!parsed.ok) {
    process.stderr.write(`Could not parse sft-report.json: ${parsed.error}\n`);
    return 1;
  }

  const failedOutput = collectFailedOutput(parsed.report);
  if (failedOutput.length === 0) {
    process.stdout.write("No failed tasks in sft-report.json. Nothing to suggest.\n");
    return 0;
  }

  process.stderr.write(`${failedOutput}\n`);
  process.stdout.write(`${banner("AI suggestion (BYOK)")}\n`);

  try {
    const provider = createProvider();
    const result = await suggestFix(
      provider,
      {
        ruleId: "unknown",
        file: "<see report>",
        line: 0,
        message: failedOutput.slice(0, MAX_MESSAGE_CHARS),
        // Phase 2 has no snippet fetcher — the failure output is the context.
        snippet: "",
      },
    );
    const suggestion = result.suggestion;
    const llmResponse = result.response;
    appendLlmCall({
      provider: llmResponse.provider,
      model: llmResponse.model,
      endpoint: llmResponse.endpoint,
      mode: "suggest",
      usage: llmResponse.usage,
      pricing: provider.pricing,
      totalCostUsd: computeCostUsd(llmResponse.usage, provider.pricing),
      durationMs: llmResponse.durationMs,
    });
    process.stdout.write(`${suggestion.explanation}\n\n${suggestion.patchDiff}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${fail("suggest failed")}: ${String(error)}\n`);
    return 1;
  }
}

