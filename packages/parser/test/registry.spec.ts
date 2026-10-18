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

  it("PARSERS.vitest resolves to parseVitest, distinct from PARSERS.jest", () => {
    // vitest now has its own dedicated parser; it no longer shares parseJest.
    expect(PARSERS["vitest"]!.parse).not.toBe(PARSERS["jest"]!.parse);
    expect(PARSERS["vitest"]!.id).toBe("vitest");
  });

  it("TASK_NAME_TO_PARSER maps Go task names", () => {
    expect(TASK_NAME_TO_PARSER["Go Tests"]).toBe("go-test");
    expect(TASK_NAME_TO_PARSER["Go Vet"]).toBe("go-vet");
  });

  it("TASK_NAME_TO_PARSER maps Security to semgrep", () => {
    expect(TASK_NAME_TO_PARSER["Security"]).toBe("semgrep");
  });

  it("TASK_NAME_TO_PARSER does not include 'Build'", () => {
    // Deliberate omission: the runner's Build task has no parser until M4
    // decides on next-build parsing; the lookup miss maps to [].
    expect(TASK_NAME_TO_PARSER["Build"]).toBeUndefined();
  });

  it("task.parser wins over the task-name map", () => {
    // Same stdout, two ids: the explicit parser (Phase 3e) decides, the name
    // mapping is only the fallback.
    const explicit = parseTask(
      task({
        name: "Custom Scan",
        command: "my-tool --json",
        stdout: fixture("json-output.json"),
        parser: "json",
        parserConfig: {
          path: "results",
          fields: { file: "file", line: "loc.line", col: "loc.col", message: "message", severity: "level", ruleId: "rule" },
          severityMap: { ERROR: "error", NOTICE: "info" },
        },
      }),
    );
    const byName = parseTask(task({ stdout: fixture("json-output.json") }));

    expect(byName).toEqual([]);
    expect(explicit).toHaveLength(2);
    expect(explicit[0]!.ruleId).toBe("SQL-INJECTION");
  });

  it("an explicit parser id that is not registered yields []", () => {
    expect(
      parseTask(task({ name: "Custom", command: "x", stdout: "[]", parser: "no-such-parser" })),
    ).toEqual([]);
  });

  it("config-tier parsers are registered but not name-mapped", () => {
    expect(PARSERS["json"]).toBeDefined();
    expect(TASK_NAME_TO_PARSER["json"]).toBeUndefined();
  });
});