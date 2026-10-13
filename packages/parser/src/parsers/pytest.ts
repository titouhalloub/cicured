import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/** `tests/test_foo.py::test_bar FAILED` — the `-v` result line. */
const RESULT_LINE = /^(\S+\.py)::(\S+)\s+(FAILED|PASSED|ERROR|SKIPPED)/;
/** FAILURES separator: `____ test_sub ____` — starts one traceback block. */
const SEPARATOR_LINE = /^_{5,}.*_{5,}$/;
/** Traceback location line: `tests/test_foo.py:12: AssertionError`. */
const LOCATION_LINE = /^\s*(\S+\.py):(\d+):/;
/** Assertion line inside a traceback: `E       assert 1 == 2`. */
const ASSERTION_LINE = /^E\s+(.+)$/;

/** One traceback block from the FAILURES section. */
interface TracebackBlock {
  line?: number;
  message?: string;
}

/**
 * Parses `python3 -m pytest -v --no-header --tb=short` output into findings.
 * One finding per FAILED/ERROR test (PASSED/SKIPPED are ignored); the
 * traceback blocks in the FAILURES section are zipped onto the failing tests
 * in run order. Never throws; obeys the M3a contract (2 MB cap, 500 findings,
 * synthetic SFT_TRUNCATED marker).
 */
export function parsePytest(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const lines = out.text.split(/\r?\n/);

    // 1. Failing tests in run order. The reversed `FAILED path::name` summary
    //    lines do not match RESULT_LINE, so they cannot double-count.
    const failures: Array<{ file: string; ruleId: string }> = [];
    for (const line of lines) {
      const match = RESULT_LINE.exec(line);
      if (match && (match[3] === "FAILED" || match[3] === "ERROR")) {
        failures.push({ file: match[1], ruleId: `${match[1]}::${match[2]}` });
      }
    }

    // 2. Traceback blocks in the FAILURES section, in order.
    const blocks: TracebackBlock[] = [];
    let current: TracebackBlock | null = null;
    for (const line of lines) {
      if (SEPARATOR_LINE.test(line)) {
        current = {};
        blocks.push(current);
        continue;
      }
      if (current === null) continue;
      if (current.line === undefined) {
        const location = LOCATION_LINE.exec(line);
        if (location) current.line = Number.parseInt(location[2], 10);
      }
      if (current.message === undefined) {
        const assertion = ASSERTION_LINE.exec(line);
        if (assertion) current.message = assertion[1].trim();
      }
    }

    // 3. Zip failures onto their tracebacks; a missing block degrades to the
    //    documented defaults (line 1, "test failed").
    const findings: ParsedFinding[] = failures.slice(0, limit).map((failure, index) => ({
      severity: "error",
      category: "test",
      ruleId: failure.ruleId,
      file: failure.file,
      line: blocks[index]?.line ?? 1,
      col: 1,
      message: blocks[index]?.message ?? "test failed",
    }));

    if (truncated) findings.push(truncatedFinding("test"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}