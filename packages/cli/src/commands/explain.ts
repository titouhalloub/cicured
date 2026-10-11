import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Namespace import, not a named one: @sft/schemas has no "type": "module"
// and no exports map, so Node's native ESM loader (via tsx) reads it as CJS
// and cjs-module-lexer cannot statically resolve the barrel `export *` chain.
import * as schemas from "@sft/schemas";
import { blastRadiusFor, buildCodeGraph, parseReport } from "@sft/parser";
import { explainFinding, type SuggestInput } from "../llm";
import { snippetFor } from "../snippet";
import { banner } from "../ui";

const USAGE = "Usage: sft explain <n>";

/** Parses a 1-based finding index from argv. Returns null when invalid. */
function parseIndex(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n >= 1 ? n : null;
}

export async function explainCommand(args: string[]): Promise<number> {
  const n = parseIndex(args[0]);
  if (n === null) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }

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

  const findings = parseReport(parsed.report);
  if (n > findings.length) {
    process.stderr.write(`Finding #${n} out of range (have ${findings.length}).\n`);
    return 1;
  }
  const finding = findings[n - 1];

  const snippet = snippetFor(finding);
  const graph = await buildCodeGraph({ rootDir: process.cwd() });
  const neighborhood = blastRadiusFor(graph, finding);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write("Set ANTHROPIC_API_KEY to use sft explain.\n");
    return 1;
  }

  const input: SuggestInput = {
    ruleId: finding.ruleId,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    snippet,
    neighborhood,
  };

  try {
    const explanation = await explainFinding(input, { apiKey });
    process.stdout.write(`${explanation}\n\n`);
    process.stdout.write(`${banner("Context")}\n`);
    process.stdout.write(`File: ${finding.file}:${finding.line}:${finding.col}\n`);
    process.stdout.write(`Rule: ${finding.ruleId}\n`);
    process.stdout.write(
      `Callers: ${neighborhood?.callers.length ?? 0}   ` +
        `Callees: ${neighborhood?.callees.length ?? 0}   ` +
        `Tests: ${neighborhood?.tests.length ?? 0}\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`explain failed: ${String(error)}\n`);
    return 1;
  }
}
