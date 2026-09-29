import { PARSER_LIMITS } from "@sft/schemas";

/**
 * Deterministic parser — M1 scaffold only (Spec §11: parsers land in M3).
 *
 * M3 will fill this in: validate `sft-report.json` with `parseSftReport`, then
 * classify tsc / eslint / jest-vitest / next-build output into `Finding`s with
 * locked `rule_id` formats and stable fingerprints. No LLM code touches this
 * package (Spec §4 step 8: deterministic first).
 */
export const PARSER_PACKAGE_VERSION = "0.1.0";

export class ParserNotImplementedError extends Error {
  constructor() {
    super(
      "packages/parser is an M1 scaffold; deterministic parsers land in M3 (Spec §11)",
    );
    this.name = "ParserNotImplementedError";
  }
}

/** Re-exported so the M3 implementation and its callers share one cap source. */
export { PARSER_LIMITS };

/**
 * Placeholder for the M3 entry point: `parseReport(report) -> Finding[]`.
 * Deliberately throws so nothing can silently depend on unfinished parsing.
 */
export function parseReport(_report: unknown): never {
  throw new ParserNotImplementedError();
}
