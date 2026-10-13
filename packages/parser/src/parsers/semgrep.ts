import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";
import { stripRepoPrefix } from "./eslint";

/** One entry of `semgrep scan --json`'s `results` array. */
interface SemgrepResult {
  check_id?: string;
  path?: string;
  start?: { line?: number; col?: number };
  extra?: {
    message?: string;
    severity?: string;
    metadata?: { category?: string };
  };
}

/**
 * Maps a Semgrep severity to the ParsedFinding enum, handling both naming
 * schemes Semgrep has used: the legacy uppercase (ERROR/WARNING/INFO) and the
 * newer LOW/MEDIUM/HIGH/CRITICAL. Unknown values fall back to "warning".
 */
function mapSeverity(value: string | undefined): ParsedFinding["severity"] {
  switch ((value ?? "").toUpperCase()) {
    case "ERROR":
    case "HIGH":
    case "CRITICAL":
      return "error";
    case "WARNING":
    case "MEDIUM":
      return "warning";
    case "INFO":
    case "LOW":
      return "info";
    default:
      return "warning";
  }
}

/**
 * Parses `semgrep scan --json` output into findings — one per result. The
 * category enum has no "security" member, so security findings are recorded as
 * "lint" (matching eslint/go-vet) and the security nature is preserved in the
 * ruleId (`*.security.*`). Never throws; obeys the M3a contract (2 MB cap, 500
 * findings, synthetic SFT_TRUNCATED marker).
 */
export function parseSemgrep(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    let parsed: unknown;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      console.warn("[@sft/parser] semgrep output is not valid JSON; skipping");
      return [];
    }
    if (typeof parsed !== "object" || parsed === null) {
      console.warn("[@sft/parser] semgrep output is not a JSON object; skipping");
      return [];
    }

    const results = (parsed as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      console.warn("[@sft/parser] semgrep output has no results array; skipping");
      return [];
    }

    const findings: ParsedFinding[] = [];
    for (const raw of results.slice(0, limit)) {
      if (typeof raw !== "object" || raw === null) continue;
      const result = raw as SemgrepResult;
      findings.push({
        severity: mapSeverity(result.extra?.severity),
        category: "lint",
        ruleId: typeof result.check_id === "string" && result.check_id !== "" ? result.check_id : "semgrep",
        // Findings store repo-relative files; strip the sandbox prefix and any
        // other leading slash an absolute scan path may carry.
        file: stripRepoPrefix(typeof result.path === "string" ? result.path : "<unknown>").replace(/^\//, ""),
        line: typeof result.start?.line === "number" ? result.start.line : 1,
        col: typeof result.start?.col === "number" ? result.start.col : 1,
        message: (typeof result.extra?.message === "string" ? result.extra.message.trim() : "") || "Semgrep finding",
      });
    }

    if (truncated) findings.push(truncatedFinding("lint"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}
