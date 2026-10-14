import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/** A result line: `test tests::test_bar ... FAILED`. */
const RESULT_LINE = /^test\s+(\S+)\s+\.\.\.\s+(.*)$/;

/** A failure block delimiter: `---- tests::test_bar stdout ----`. */
const BLOCK_HEADER = /^-+\s+(\S+)\s+stdout\s+-+\s*$/;

/**
 * A panic line, which rustc wraps across lines:
 *   thread 'tests::test_bar' panicked at 'assertion failed: `(left == right)`
 *     left: `1`,
 *    right: `2`', src/lib.rs:42:5
 */
const PANIC_LINE = /panicked at '(.+?)',\s*(\S+\.rs):(\d+):(\d+)/s;

/**
 * Parses `cargo test --no-fail-fast` output into findings — one per failing
 * test. Two passes, like the pytest parser: result lines first (failures in
 * run order), then the `---- <name> stdout ----` blocks that carry the panic
 * location. `cargo test --format json` is nightly-only, so the human-readable
 * stream is the stable path. Never throws; obeys the M3a contract (2 MB cap,
 * 500 findings, synthetic SFT_TRUNCATED marker).
 */
export function parseCargoTest(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const lines = out.text.split(/\r?\n/);

    // Pass 1: failed test names, in run order.
    const failures: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      const match = RESULT_LINE.exec(line);
      if (!match) continue;
      if (match[2].trim() !== "FAILED") continue; // ok / ignored / measured / filtered out
      const name = match[1];
      if (seen.has(name)) continue;
      seen.add(name);
      failures.push(name);
    }
    if (failures.length === 0) return [];

    // Pass 2: one failure block per `---- <name> stdout ----` delimiter,
    // running until the next blank line or delimiter.
    const blocks = new Map<string, string>();
    for (let i = 0; i < lines.length; i += 1) {
      const header = BLOCK_HEADER.exec(lines[i].trim());
      if (!header) continue;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        if (next.trim() === "" || BLOCK_HEADER.test(next.trim())) break;
        body.push(next);
      }
      if (!blocks.has(header[1])) blocks.set(header[1], body.join("\n"));
    }

    const findings: ParsedFinding[] = [];
    for (const failure of failures.slice(0, limit)) {
      const block = blocks.get(failure) ?? "";
      // The panic line wraps, so match against the whole block with /s and
      // collapse the captured message to one line.
      const panic = PANIC_LINE.exec(block);
      const message = panic
        ? panic[1].replace(/\s+/g, " ").trim()
        : (block.split("\n").find((l) => l.trim() !== "")?.trim() ?? "test failed");
      findings.push({
        severity: "error",
        category: "test",
        ruleId: "cargo-test",
        // The test id is the most specific handle we have; the file is unknown
        // unless the panic line carries one.
        file: panic ? panic[2] : "unknown",
        line: panic ? Number.parseInt(panic[3], 10) : 1,
        col: panic ? Number.parseInt(panic[4], 10) : 1,
        message: message === "" ? "test failed" : message,
      });
    }

    if (truncated) findings.push(truncatedFinding("test"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}
