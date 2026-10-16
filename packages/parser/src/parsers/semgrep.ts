import type { ParsedFinding } from "../types";

/** One entry of `semgrep --json`'s `results` array. */
interface SemgrepResult {
  check_id?: string;
  path?: string;
  start?: { line?: number; col?: number };
  extra?: {
    message?: string;
    severity?: string;
  };
}

/**
 * Map a Semgrep severity to the finding severity.
 * ERROR -> "error", WARNING -> "warning", INFO -> "info",
 * anything else (including missing) -> "warning".
 */
function mapSeverity(value: string | undefined): ParsedFinding["severity"] {
  switch ((value ?? "").toUpperCase()) {
    case "ERROR":
      return "error";
    case "WARNING":
      return "warning";
    case "INFO":
      return "info";
    default:
      return "warning";
  }
}

/**
 * Parse Semgrep JSON output into findings.
 * Never throws: on invalid JSON returns [] and pushes "semgrep: invalid JSON"
 * into the optional warnings array. Skips results missing check_id, path, or
 * start.line. Does not deduplicate; preserves Semgrep's result order.
 */
export function parseSemgrep(
  stdout: string,
  warnings?: string[],
): ParsedFinding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    warnings?.push("semgrep: invalid JSON");
    return [];
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { results?: unknown }).results)
  ) {
    return [];
  }
  const findings: ParsedFinding[] = [];
  for (const raw of (parsed as { results: SemgrepResult[] }).results) {
    if (typeof raw !== "object" || raw === null) continue;
    const { check_id, path, start, extra } = raw;
    if (!check_id || !path || typeof start?.line !== "number") continue;
    findings.push({
      severity: mapSeverity(extra?.severity),
      category: "lint",
      ruleId: check_id,
      file: path,
      line: start.line,
      col: typeof start.col === "number" ? start.col : 0,
      message: typeof extra?.message === "string" ? extra.message : "",
    });
  }
  return findings;
}
