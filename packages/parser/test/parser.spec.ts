import { describe, expect, it } from "vitest";
import {
  PARSER_LIMITS,
  PARSER_PACKAGE_VERSION,
  ParserNotImplementedError,
  parseReport,
} from "../src/index";

describe("parser scaffold (M1)", () => {
  it("exposes a package version", () => {
    expect(PARSER_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("fails loudly instead of pretending to parse", () => {
    expect(() => parseReport({ version: 2 })).toThrow(ParserNotImplementedError);
    expect(() => parseReport({ version: 2 })).toThrow(/M3/);
  });

  it("shares the parser caps from @sft/schemas", () => {
    expect(PARSER_LIMITS.maxReportBytes).toBe(2 * 1024 * 1024);
    expect(PARSER_LIMITS.maxTaskStreamChars).toBe(200_000);
    expect(PARSER_LIMITS.maxFindingsPerRun).toBe(50);
  });
});
