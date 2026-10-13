import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";
import { stripRepoPrefix } from "./eslint";

/** A vet diagnostic: `foo.go:42:5: non-constant format string in call to ...`. */
const DIAGNOSTIC_LINE = /^(.+\.go):(\d+):(\d+):\s*(.+)$/;

/**
 * Parses `go vet ./...` output into findings — one per diagnostic. Package
 * headers (`# example.com/foo`) and blank lines are skipped; every diagnostic
 * becomes an error because vet findings are defects, never style nits. Never
 * throws; obeys the M3a contract (2 MB cap, 500 findings, synthetic
 * SFT_TRUNCATED marker).
 */
export function parseGoVet(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const findings: ParsedFinding[] = [];
    for (const line of out.text.split(/\r?\n/)) {
      if (line.trim() === "" || line.startsWith("#")) continue;
      const match = DIAGNOSTIC_LINE.exec(line.trim());
      if (!match) continue;
      if (findings.length >= limit) break;
      findings.push({
        severity: "error",
        category: "lint",
        ruleId: "go-vet",
        // Findings store repo-relative files; strip the sandbox prefix and any
        // other leading slash an absolute vet run may produce.
        file: stripRepoPrefix(match[1]).replace(/^\//, ""),
        line: Number.parseInt(match[2], 10),
        col: Number.parseInt(match[3], 10),
        message: match[4].trim(),
      });
    }

    if (truncated) findings.push(truncatedFinding("lint"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}
