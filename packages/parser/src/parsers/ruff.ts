import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";
import { stripRepoPrefix } from "./eslint";

/** One entry of `ruff check --output-format=json`. */
interface RuffEntry {
  code?: string;
  filename?: string;
  location?: { row?: number; column?: number };
  message?: string;
}

/**
 * Parses `ruff check --output-format=json` output into findings. Security
 * rules (S*) are errors; every other code is a warning. Never throws; obeys
 * the M3a contract (2 MB cap, 500 findings, synthetic SFT_TRUNCATED marker).
 */
export function parseRuff(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    let entries: unknown;
    try {
      entries = JSON.parse(out.text);
    } catch {
      console.warn("[@sft/parser] ruff output is not valid JSON; skipping");
      return [];
    }
    if (!Array.isArray(entries)) {
      console.warn("[@sft/parser] ruff output is not a JSON array; skipping");
      return [];
    }

    const findings: ParsedFinding[] = [];
    for (const raw of entries.slice(0, limit)) {
      if (typeof raw !== "object" || raw === null) continue;
      const entry = raw as RuffEntry;
      const code = typeof entry.code === "string" ? entry.code : "";
      // Findings store repo-relative files; strip the sandbox prefix and any
      // other leading slash a local ruff run may produce.
      const file = stripRepoPrefix(
        typeof entry.filename === "string" ? entry.filename : "<unknown>",
      ).replace(/^\//, "");
      findings.push({
        severity: /^S/.test(code) ? "error" : "warning",
        category: "lint",
        ruleId: code === "" ? "ruff" : code,
        file,
        line: typeof entry.location?.row === "number" ? entry.location.row : 1,
        col: typeof entry.location?.column === "number" ? entry.location.column : 1,
        message: typeof entry.message === "string" ? entry.message : "ruff violation",
      });
    }

    if (truncated) findings.push(truncatedFinding("lint"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}