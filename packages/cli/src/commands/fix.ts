import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
// Namespace import, not a named one: @sft/schemas has no "type": "module"
// and no exports map, so Node's native ESM loader (via tsx) reads it as CJS
// and cjs-module-lexer cannot statically resolve the barrel `export *` chain.
import * as schemas from "@sft/schemas";
import { blastRadiusFor, buildCodeGraph, parseReport } from "@sft/parser";
import { createProvider, suggestFix, type LlmSuggestion, type SuggestInput } from "../llm";
import { snippetFor } from "../snippet";
import { banner } from "../ui";

const USAGE = "Usage: sft fix <n>";

/** Parses a 1-based finding index from argv. Returns null when invalid. */
function parseIndex(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return n >= 1 ? n : null;
}

/** Reads one line from stdin. Resolves "" on EOF. Never throws. */
function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const finish = (line: string): void => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.pause();
      resolve(line);
    };
    const onData = (chunk: Buffer | string): void => {
      finish(chunk.toString().split(/\r?\n/, 1)[0] ?? "");
    };
    const onEnd = (): void => finish("");
    stdin.once("data", onData);
    stdin.once("end", onEnd);
    stdin.resume();
  });
}

interface GitResult {
  ok: boolean;
  /** git binary missing or not on PATH (spawn raised ENOENT). */
  missing: boolean;
  stderr: string;
}

/** Runs git with the given args. Never throws — a missing binary is `missing`. */
function runGit(args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const settle = (result: GitResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    // `error` (ENOENT) and `close` can both fire; the first one wins.
    child.once("error", (error: NodeJS.ErrnoException) => {
      settle({ ok: false, missing: error.code === "ENOENT", stderr: error.message });
    });
    child.once("close", (code) => {
      settle({ ok: code === 0, missing: false, stderr });
    });
  });
}

export async function fixCommand(args: string[]): Promise<number> {
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

  const input: SuggestInput = {
    ruleId: finding.ruleId,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    snippet,
    neighborhood,
  };

  let suggestion: LlmSuggestion;
  try {
    const provider = createProvider();
    suggestion = await suggestFix(provider, input);
  } catch (error) {
    process.stderr.write(`suggest failed: ${String(error)}\n`);
    return 1;
  }

  process.stdout.write(`${suggestion.explanation}\n\n`);
  process.stdout.write(`${banner("Patch")}\n`);
  process.stdout.write(`${suggestion.patchDiff}\n`);

  process.stdout.write("Apply this patch? [y/N] ");
  const answer = (await readLine()).trim();
  if (answer !== "y" && answer !== "Y") {
    process.stdout.write("Patch discarded.\n");
    return 0;
  }

  const patchFile = path.join(
    os.tmpdir(),
    `sft-patch-${randomBytes(8).toString("hex")}.patch`,
  );
  // Normalise CRLF before handing the patch to git — git apply wants LF.
  writeFileSync(patchFile, suggestion.patchDiff.replace(/\r\n/g, "\n"), "utf8");

  const check = await runGit(["apply", "--check", patchFile]);
  if (check.missing) {
    process.stderr.write("git is required to apply patches.\n");
    return 1;
  }
  if (!check.ok) {
    process.stderr.write(
      `Patch did not apply cleanly: ${check.stderr.replace(/\s+$/, "")}\n`,
    );
    return 1;
  }

  const applied = await runGit(["apply", patchFile]);
  if (applied.missing) {
    process.stderr.write("git is required to apply patches.\n");
    return 1;
  }
  if (!applied.ok) {
    process.stderr.write(
      `Patch did not apply cleanly: ${applied.stderr.replace(/\s+$/, "")}\n`,
    );
    return 1;
  }

  unlinkSync(patchFile);
  process.stdout.write("Patch applied.\n");
  return 0;
}
