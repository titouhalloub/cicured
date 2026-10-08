import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/** Message body cap for a single failing test. */
const MESSAGE_CAP = 500;

const VITEST_FILE = "\u276F"; // ❯
const JEST_FAIL = "\u25CF"; // ●

/** Strips a leading `./` so relTestPath is repo-relative. */
function relPath(file: string): string {
  const trimmed = file.trim();
  return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

/** Vitest file header: contains `❯` and ends with `)`. */
function isVitestHeader(line: string): boolean {
  return line.includes(VITEST_FILE) && line.trimEnd().endsWith(")");
}

/** Other test-result lines that terminate a failure block. */
function isTestResultLine(line: string): boolean {
  return /^\s*[✓↓○]\s/.test(line) || /^\s*×\s/.test(line) || line.includes(JEST_FAIL);
}

/**
 * The message is the first following non-blank, non-header line; the block
 * ends at the next header, failure marker, or passing-test line.
 */
function extractMessage(lines: string[], index: number): string {
  for (let i = index + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (isVitestHeader(line)) break;
    if (line.startsWith("FAIL ") || line.startsWith("PASS ")) break;
    if (isTestResultLine(line)) break;
    const message = line.replace(/^\s*→\s?/, "").trim();
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
 * Parses jest (`FAIL` + `●`) and vitest (`❯` + `×`) failure summaries into
 * findings. Never throws; obeys the M3a contract (2 MB cap, 500 findings,
 * synthetic SFT_TRUNCATED marker).
 */
export function parseJest(stdout: string, stderr: string): ParsedFinding[] {
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
        if (isVitestHeader(line)) {
          const after = line.slice(line.indexOf(VITEST_FILE) + 1).trim();
          currentFile = after.replace(/\s+\(.*\)$/, "").trim();
          continue;
        }
        if (line.startsWith("FAIL ")) {
          currentFile = line.slice("FAIL ".length).trim();
          continue;
        }
        const vitestFail = /^\s*×\s*(.*)$/.exec(line);
        if (vitestFail) {
          if (findings.length >= limit) continue;
          findings.push(
            findingFor(
              currentFile,
              vitestFail[1],
              extractMessage(lines, i),
            ),
          );
          continue;
        }
        if (line.startsWith("  ● ")) {
          if (findings.length >= limit) continue;
          findings.push(
            findingFor(
              currentFile,
              line.slice(line.indexOf(JEST_FAIL) + 1),
              extractMessage(lines, i),
            ),
          );
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