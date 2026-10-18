import { PARSER_LIMITS, type SftReportV2 } from "@sft/schemas";
import { computeFingerprint } from "./fingerprint";
import { parseTask } from "./parsers/index";
import type { ParsedFinding } from "./types";

export * from "./types";
export { bucketLine, computeFingerprint, normalizeMessage } from "./fingerprint";
export { parseTsc } from "./parsers/tsc";
export { parseEslint, stripRepoPrefix } from "./parsers/eslint";
export { parseJest } from "./parsers/jest";
export { parsePytest } from "./parsers/pytest";
export { parseRuff } from "./parsers/ruff";
export { parseGoTest } from "./parsers/go-test";
export { parseGoVet } from "./parsers/go-vet";
export { parseSemgrep } from "./parsers/semgrep";
export { parseCargoClippy } from "./parsers/cargo-clippy";
export { parseCargoTest } from "./parsers/cargo-test";
export { parseVitest } from "./parsers/vitest";
export { parseJson } from "./parsers/json";
export { parseTask } from "./parsers/index";
export type { Parser } from "./parsers/registry";
export { PARSERS, TASK_NAME_TO_PARSER } from "./parsers/registry";

// Explicit (not `export *`) so Node's CJS named-export lexer sees these when
// `bin/sft.mjs` runs the CLI through tsx — `export *` names are invisible to
// static named imports at runtime and crash `sft graph` at link time.
export {
  DEFAULT_EXCLUDE_PATTERNS,
  DEFAULT_MAX_FILES,
  DEFAULT_TEST_PATTERNS,
  blastRadiusFor,
  buildCodeGraph,
  findFile,
  findFunction,
  readCachedGraph,
  writeCachedGraph,
} from "./codegraph";
export type { BuildOptions, Neighborhood } from "./codegraph";
export {
  initWalkers,
  WALKERS,
  WALKER_SOURCE_EXTENSIONS,
  walkerForFile,
} from "./graph/walker";
export type { LanguageWalker, RawFileGraph } from "./graph/walker";
export { tsWalker } from "./graph/ts-walker";
export { pythonWalker } from "./graph/python-walker";
export { goWalker } from "./graph/go-walker";
export { rustWalker } from "./graph/rust-walker";
export { formatNeighborhoodBlock } from "./graph/prompt";

/**
 * Deterministic findings parser (Spec §4 step 8: deterministic first, no
 * LLM). tsc parsing + fingerprints land in M3a; eslint / jest-vitest /
 * next-build parsers land in M3b.
 */
export const PARSER_PACKAGE_VERSION = "0.1.0";

/** Re-exported so callers and tests share one cap source with @sft/schemas. */
export { PARSER_LIMITS };

/** A parsed finding with its locked Spec §5 fingerprint attached. */
export interface FindingsWithFingerprint extends ParsedFinding {
  fingerprint: string;
}

/**
 * Parses every task of a validated `sft-report.json` and attaches a
 * fingerprint to each finding. Never throws: any malformed input yields [].
 */
export function parseReport(report: SftReportV2): FindingsWithFingerprint[] {
  try {
    const findings: FindingsWithFingerprint[] = [];
    for (const task of report.tasks) {
      for (const finding of parseTask(task)) {
        findings.push({ ...finding, fingerprint: computeFingerprint(finding) });
      }
    }
    return findings;
  } catch {
    return [];
  }
}
