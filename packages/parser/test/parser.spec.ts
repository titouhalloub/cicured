import { describe, expect, it } from "vitest";
import { PARSER_LIMITS, PARSER_PACKAGE_VERSION } from "../src/index";

describe("parser package surface", () => {
  it("exposes a package version", () => {
    expect(PARSER_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("shares the parser caps from @sft/schemas", () => {
    expect(PARSER_LIMITS.maxReportBytes).toBe(2 * 1024 * 1024);
    expect(PARSER_LIMITS.maxTaskStreamChars).toBe(200_000);
    expect(PARSER_LIMITS.maxFindingsPerRun).toBe(50);
  });
});
