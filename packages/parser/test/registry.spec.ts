import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SftTaskV2 } from "@sft/schemas";
import { PARSERS, parseTask, TASK_NAME_TO_PARSER } from "../src/index";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

/** A schema-valid SftTaskV2 with overridable fields. */
function task(overrides: Partial<SftTaskV2>): SftTaskV2 {
  return {
    name: "Type Check",
    command: "tsc --noEmit",
    success: false,
    exitCode: 1,
    timedOut: false,
    skipped: false,
    truncated: false,
    durationMs: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

describe("parser registry", () => {
  it("every task name in TASK_NAME_TO_PARSER resolves to a registered parser", () => {
    for (const [taskName, parserId] of Object.entries(TASK_NAME_TO_PARSER)) {
      expect(PARSERS[parserId], `task "${taskName}" -> parser "${parserId}"`).toBeDefined();
    }
  });

  it("every parser has a non-empty id matching its registry key", () => {
    for (const [key, parser] of Object.entries(PARSERS)) {
      expect(parser.id).toBe(key);
      expect(parser.id.length).toBeGreaterThan(0);
    }
  });

  it("parseTask dispatches by task name", () => {
    const findings = parseTask(task({ stdout: fixture("tsc-single-error.txt") }));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.ruleId).toBeDefined();
  });

  it("parseTask returns [] for an unknown task name", () => {
    expect(parseTask(task({ name: "Not a Real Task", stdout: "anything", exitCode: 0 }))).toEqual([]);
  });

  it("PARSERS.jest and PARSERS.vitest resolve to the same parse function", () => {
    // parseJest handles both the jest and vitest summary formats, so the
    // registry deliberately shares one implementation between the two ids.
    expect(PARSERS["jest"]!.parse).toBe(PARSERS["vitest"]!.parse);
  });

  it("TASK_NAME_TO_PARSER does not include 'Build'", () => {
    // Deliberate omission: the runner's Build task has no parser until M4
    // decides on next-build parsing; the lookup miss maps to [].
    expect(TASK_NAME_TO_PARSER["Build"]).toBeUndefined();
  });
});