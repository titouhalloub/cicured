import type { SftTaskV2 } from "@sft/schemas";
import type { ParsedFinding } from "../types";
import { parseEslint } from "./eslint";
import { parseJest } from "./jest";
import { parsePytest } from "./pytest";
import { parseRuff } from "./ruff";
import { parseTsc } from "./tsc";

/**
 * Dispatches a report task to its parser. M3b wires tsc, eslint and
 * jest/vitest; "Build" stays empty until M4 decides on next-build parsing.
 * Phase 3d-1 adds the Python tasks produced by the runner.
 */
export function parseTask(task: SftTaskV2): ParsedFinding[] {
  try {
    switch (task.name) {
      case "Type Check":
        return parseTsc(task.stdout, task.stderr);
      case "Lint":
        return parseEslint(task.stdout, task.stderr);
      case "Tests":
        return parseJest(task.stdout, task.stderr);
      case "Python Tests":
        return parsePytest(task.stdout, task.stderr);
      case "Python Lint":
        return parseRuff(task.stdout, task.stderr);
      case "Build":
        return [];
      default:
        return [];
    }
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}