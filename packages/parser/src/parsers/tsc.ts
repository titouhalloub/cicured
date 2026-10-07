import type { ParsedFinding } from "../types";

/** Per-stream input cap: tails beyond 2 MB are dropped (attacker-controlled output). */
const MAX_INPUT_CHARS = 2 * 1024 * 1024;
/** Hard cap on findings emitted per task. */
const MAX_FINDINGS = 500;

/**
 * `tsc --noEmit --pretty false` emits one line per error:
 *   `<file>(<line>,<col>): error TS<code>: <message>`
 * `error` may be `warning`; be lenient. A wrapped message continues on the
 * next indented line.
 */
const TSC_FINDING_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

function capInput(input: string): { text: string; truncated: boolean } {
  if (input.length <= MAX_INPUT_CHARS) return { text: input, truncated: false };
  return { text: input.slice(0, MAX_INPUT_CHARS), truncated: true };
}

function truncatedFinding(): ParsedFinding {
  return {
    severity: "warning",
    category: "typecheck",
    ruleId: "SFT_TRUNCATED",
    file: "<parser>",
    line: 0,
    col: 0,
    message: "parser input exceeded the 2 MB cap; output beyond the cap was not parsed",
  };
}

/**
 * Parses `tsc --pretty false` output into findings. Never throws: any input
 * (megabytes of anything) yields at most `MAX_FINDINGS` findings.
 */
export function parseTsc(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    // Reserve one slot so the synthetic truncation marker always fits.
    const limit = truncated ? MAX_FINDINGS - 1 : MAX_FINDINGS;

    const findings: ParsedFinding[] = [];

    const consume = (text: string): void => {
      let current: ParsedFinding | undefined;
      for (const line of text.split(/\r?\n/)) {
        const match = TSC_FINDING_LINE.exec(line);
        if (match) {
          if (findings.length >= limit) {
            current = undefined;
            continue;
          }
          const finding: ParsedFinding = {
            severity: match[4] as "error" | "warning",
            category: "typecheck",
            ruleId: match[5],
            file: match[1],
            line: Number.parseInt(match[2], 10),
            col: Number.parseInt(match[3], 10),
            message: match[6].trim(),
          };
          findings.push(finding);
          current = finding;
        } else if (current && line.trim() !== "" && /^\s/.test(line)) {
          // Wrapped message: append the indented continuation with a space.
          current.message = `${current.message} ${line.trim()}`;
        }
        // All other lines are ignored.
      }
    };

    consume(out.text);
    consume(err.text);

    if (truncated) findings.push(truncatedFinding());
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}