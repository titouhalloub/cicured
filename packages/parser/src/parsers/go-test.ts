import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";

/** One event of `go test -json` (Test2JSON). Only the fields we parse. */
interface GoTestEvent {
  Action?: string;
  Package?: string;
  Test?: string;
  Output?: string;
}

/** A source line inside a test's output: `    foo_test.go:42: expected 1, got 2`. */
const SOURCE_LINE = /^\s*(\S+\.go):(\d+):\s*(.+)$/;

/** Map key for one test: `example.com/foo::TestBar`. */
const testKey = (pkg: string, test: string): string => `${pkg}::${test}`;

/**
 * Parses `go test -json ./...` output into findings — one per failing test,
 * with the file:line and message lifted from the first `*.go:NN:` line in that
 * test's accumulated output. Package-level failures without a `Test` field are
 * ignored (nothing to attribute a finding to); passing and skipped tests are
 * ignored. Never throws; obeys the M3a contract (2 MB cap, 500 findings,
 * synthetic SFT_TRUNCATED marker).
 */
export function parseGoTest(stdout: string, stderr: string): ParsedFinding[] {
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    const outputLines = new Map<string, string[]>();
    const failures: Array<{ pkg: string; test: string }> = [];
    const seen = new Set<string>();

    for (const [index, line] of out.text.split(/\r?\n/).entries()) {
      if (line.trim() === "") continue;
      let event: GoTestEvent;
      try {
        event = JSON.parse(line) as GoTestEvent;
      } catch {
        // Malformed line: warn and skip. Never emit a finding, never throw.
        console.warn(`[@sft/parser] go test output line ${index} is not valid JSON; skipping line`);
        continue;
      }
      if (typeof event !== "object" || event === null) continue;
      const pkg = typeof event.Package === "string" ? event.Package : "";
      const test = typeof event.Test === "string" ? event.Test : "";

      if (event.Action === "output") {
        if (test === "") continue;
        // Test2JSON terminates every Output chunk with "\n"; strip it so the
        // `file.go:NN: msg` patterns (which are not multiline) still match.
        const chunk = typeof event.Output === "string" ? event.Output.replace(/\r?\n$/, "") : "";
        const key = testKey(pkg, test);
        const bucket = outputLines.get(key);
        if (bucket === undefined) outputLines.set(key, [chunk]);
        else bucket.push(chunk);
        continue;
      }

      if (event.Action === "fail" && test !== "") {
        const key = testKey(pkg, test);
        if (!seen.has(key)) {
          seen.add(key);
          failures.push({ pkg, test });
        }
      }
    }

    const findings: ParsedFinding[] = [];
    for (const failure of failures.slice(0, limit)) {
      const lines = outputLines.get(testKey(failure.pkg, failure.test)) ?? [];
      // First `foo.go:42: msg` line in the test's own output — vet-style
      // compile failures surface there too, and it is the best available
      // attribution when a panic swallows the location.
      let source: { file: string; line: number; message: string } | null = null;
      for (const line of lines) {
        const match = SOURCE_LINE.exec(line);
        if (match) {
          source = {
            file: match[1],
            line: Number.parseInt(match[2], 10),
            message: match[3].trim(),
          };
          break;
        }
      }
      findings.push({
        severity: "error",
        category: "test",
        // Package-qualified: TestMain/TestFoo collide across packages, and the
        // fingerprint must survive two failing TestFoo's in one repo.
        ruleId: failure.pkg === "" ? failure.test : `${failure.pkg}::${failure.test}`,
        // Without a source line, fall back to the package path so the finding
        // is still attributable.
        file: source?.file ?? (failure.pkg === "" ? "unknown" : failure.pkg),
        line: source?.line ?? 1,
        col: 1,
        message: source?.message ?? "test failed",
      });
    }

    if (truncated) findings.push(truncatedFinding("test"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}
