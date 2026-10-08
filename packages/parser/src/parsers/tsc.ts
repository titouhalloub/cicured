import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/**
 * `tsc --noEmit --pretty false` emits one line per error:
 *   `<file>(<line>,<col>): error TS<code>: <message>`
 * `error` may be `warning`; be lenient. A wrapped message continues on the
 * next indented line.
 */
const TSC_FINDING_LINE = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/;

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
    const limit = findingLimit(truncated);

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

    if (truncated) findings.push(truncatedFinding("typecheck"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}