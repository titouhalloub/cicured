import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/** Runner sandbox path prefix, stripped so findings store repo-relative files. */
const REPO_PREFIX = "/workspace/repo/";

/** `  12:5   error    <message ...>   <rule-id>` — eslint stylish, `--no-color`. */
const FINDING_LINE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.*?)\s*$/;
/** Last-token rule id check; mirrors the locked `<rule>` / `<plugin>/<rule>` format. */
const RULE_TOKEN = /^(@[a-z0-9-]+\/)?[a-z0-9-]+$/i;

/** Strips the sandbox repo prefix so stored files are repo-relative. */
export function stripRepoPrefix(file: string): string {
  return file.startsWith(REPO_PREFIX) ? file.slice(REPO_PREFIX.length) : file;
}

/** A column-0 line that looks like a path starts a new file block. */
function looksLikePath(line: string): boolean {
  return line.length > 0 && !/^\s/.test(line) && /[/.\\]/.test(line);
}

/**
 * Parses eslint "stylish" output into findings. Never throws; obeys the M3a
 * contract (2 MB input cap, 500 findings, synthetic SFT_TRUNCATED marker).
 */
/**
 * pnpm -r prefixes every child-task output line with
 *   `<package> <script>: <original>`
 * and emits two kinds of framework lines we drop:
 *   `<package> <script>$ <command>`  (header, before task runs)
 *   `<package> <script>: Done`       (completion marker)
 * Raw eslint output (no prefix) is preserved so the parser still
 * works for direct `eslint .` invocations.
 */
function stripPnpmPrefix(raw: string): string {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (/^\S+\s+\S+\$\s+/.test(line)) continue;
    if (/^\S+\s+\S+:\s+Done\s*$/.test(line)) continue;
    const m = /^\S+\s+\S+: (.*)$/.exec(line);
    if (m) {
      out.push(m[1]);
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function parseEslint(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stripPnpmPrefix(stdout ?? ""));
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const findings: ParsedFinding[] = [];

    const consume = (text: string): void => {
      let currentFile: string | undefined;
      for (const line of text.split(/\r?\n/)) {
        if (looksLikePath(line)) {
          currentFile = stripRepoPrefix(line.trim());
          continue;
        }
        const match = FINDING_LINE.exec(line);
        if (!match) continue;
        if (findings.length >= limit) continue;

        const remainder = match[4];
        if (remainder === "") continue;

        // The rule id is the last whitespace-separated token — but only when
        // it looks like one. Parse-error lines have no rule column at all.
        const tokens = remainder.split(/\s+/);
        const last = tokens[tokens.length - 1];
        const hasRule =
          tokens.length >= 2 &&
          RULE_TOKEN.test(last) &&
          last !== "error" &&
          last !== "warning";
        const message = hasRule
          ? remainder.slice(0, remainder.length - last.length).trimEnd()
          : remainder;
        if (message === "") continue;

        findings.push({
          severity: hasRule ? (match[3] as "error" | "warning") : "error",
          category: "lint",
          ruleId: hasRule ? last : "parse-error",
          file: currentFile ?? "<unknown>",
          line: Number.parseInt(match[1], 10),
          col: Number.parseInt(match[2], 10),
          message,
        });
      }
    };

    consume(out.text);
    consume(err.text);

    if (truncated) findings.push(truncatedFinding("lint"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}