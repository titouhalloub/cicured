import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";
import { stripRepoPrefix } from "./eslint";

/**
 * One line of `cargo clippy --message-format=json` (NDJSON). Only the
 * `compiler-message` reason carries diagnostics; every other reason
 * (`compiler-artifact`, `build-finished`, `build-script-executed`, ...) is
 * ignored.
 */
interface ClippyMessage {
  reason?: string;
  message?: {
    message?: string;
    code?: { code?: string | null } | null;
    level?: string;
    spans?: ClippySpan[];
  };
}

/** One span of a diagnostic; `is_primary` marks the finding's location. */
interface ClippySpan {
  file_name?: string;
  line_start?: number;
  column_start?: number;
  is_primary?: boolean;
}

/**
 * Parses `cargo clippy --message-format=json` output (newline-delimited JSON)
 * into findings — one per compiler-message diagnostic. Each line is parsed
 * independently: a malformed line warns and is skipped without discarding the
 * rest of the stream. Never throws; obeys the M3a contract (2 MB cap, 500
 * findings, synthetic SFT_TRUNCATED marker).
 */
export function parseCargoClippy(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const findings: ParsedFinding[] = [];
    for (const [index, line] of out.text.split(/\r?\n/).entries()) {
      if (line.trim() === "") continue;
      if (findings.length >= limit) break;

      let parsed: ClippyMessage;
      try {
        parsed = JSON.parse(line) as ClippyMessage;
      } catch {
        // NDJSON: one bad line must not discard the valid diagnostics around
        // it, so warn per line and continue rather than returning [].
        console.warn(`[@sft/parser] cargo clippy output line ${index} is not valid JSON; skipping line`);
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      if (parsed.reason !== "compiler-message") continue;

      const message = parsed.message;
      if (typeof message !== "object" || message === null) continue;

      // The primary span is the diagnostic's location; fall back to the first
      // span, and skip the diagnostic entirely when there is none (there is
      // then nothing to attribute a finding to).
      const spans = Array.isArray(message.spans) ? message.spans : [];
      const span = spans.find((s) => s.is_primary === true) ?? spans[0];
      if (span === undefined) continue;

      // Notes / helps are context for a real diagnostic, not findings of
      // their own — map them to the lowest severity instead of dropping them.
      let severity: ParsedFinding["severity"] = "info";
      if (message.level === "error") severity = "error";
      else if (message.level === "warning") severity = "warning";

      findings.push({
        severity,
        category: "lint",
        ruleId: message.code?.code ?? "clippy",
        // Findings store repo-relative files; strip the sandbox prefix and any
        // other leading slash an absolute-path run may produce.
        file: stripRepoPrefix(typeof span.file_name === "string" ? span.file_name : "<unknown>").replace(/^\//, ""),
        line: typeof span.line_start === "number" ? span.line_start : 1,
        col: typeof span.column_start === "number" ? span.column_start : 1,
        message: typeof message.message === "string" ? message.message.trim() : "clippy finding",
      });
    }

    if (truncated) findings.push(truncatedFinding("lint"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}
