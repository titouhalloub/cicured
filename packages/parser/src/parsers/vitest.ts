import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/** Message body cap for a single failing test. */
const MESSAGE_CAP = 500;

/** Vitest file header marker: ❯ */
const VITEST_FILE = "\u276F"; // ❯

/** Strip a leading `./` so relTestPath is repo-relative. */
function relPath(file: string): string {
  const trimmed = file.trim();
  return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

/** Strip a pnpm package prefix like `packages/parser test vitest: `. */
function stripPnpmPrefix(line: string): string {
  // Match `<dir> <command>: ` prefix
  return line.replace(/^[^\s]+\s+[^\s]+:\s*/, "");
}

/** Vitest header line: starts with ❯ and contains test count info. */
function isVitestHeader(line: string): boolean {
  const stripped = stripPnpmPrefix(line);
  return stripped.includes(VITEST_FILE) && stripped.trimEnd().endsWith(")");
}

/** Other test-result lines that terminate a failure block. */
function isTestResultLine(line: string): boolean {
  const stripped = stripPnpmPrefix(line);
  return /^\s*[✓↓○]\s/.test(stripped) || /^\s*×\s/.test(stripped);
}

/**
 * Extracts the failure message from lines after a `×` marker.
 * The message is the first non-blank line starting with `→`, or the
 * next non-header non-empty line.
 */
function extractMessage(lines: string[], index: number): string {
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = stripPnpmPrefix(line);
    if (stripped.trim() === "") continue;
    if (isVitestHeader(stripped)) break;
    if (/^\s*FAIL\s/.test(stripped)) break;
    if (isTestResultLine(stripped)) break;
    const message = stripped.replace(/^\s*→\s?/, "").trim();
    if (message !== "") return message.slice(0, MESSAGE_CAP);
  }
  return "test failed";
}

function findingFor(
  file: string | undefined,
  testName: string,
  message: string,
): ParsedFinding {
  const rel = file ? relPath(file) : "<unknown>";
  const name = testName.trim() || "unknown";
  return {
    severity: "error",
    category: "test",
    ruleId: `${rel}::${name}`,
    file: rel,
    line: 0,
    col: 0,
    message,
  };
}

/**
 * Parses vitest (`❯` + `×`) failure summaries into findings.
 * Handles both raw vitest output and pnpm-prefixed output.
 * Never throws; obeys the M3a contract (2 MB cap, 500 findings,
 * synthetic SFT_TRUNCATED marker).
 */
export function parseVitest(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const findings: ParsedFinding[] = [];

    const consume = (text: string): void => {
      const lines = text.split(/\r?\n/);
      let currentFile: string | undefined;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const stripped = stripPnpmPrefix(line);
        if (isVitestHeader(stripped)) {
          const after = stripped.slice(stripped.indexOf(VITEST_FILE) + 1).trim();
          currentFile = after.replace(/\s+\(.*\)$/, "").trim();
          continue;
        }
        if (/^\s*FAIL\s/.test(stripped)) {
          currentFile = stripped.slice("FAIL ".length).trim();
          continue;
        }
        const vitestFail = /^\s*×\s*(.*)$/.exec(stripped);
        if (vitestFail) {
          if (findings.length >= limit) continue;
          findings.push(
            findingFor(currentFile, vitestFail[1], extractMessage(lines, i)),
          );
          continue;
        }
      }
    };

    consume(out.text);
    consume(err.text);

    if (truncated) findings.push(truncatedFinding("test"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}