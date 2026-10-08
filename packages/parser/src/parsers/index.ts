import type { SftTaskV2 } from "@sft/schemas";
import type { ParsedFinding } from "../types";
import { parseEslint } from "./eslint";
import { parseJest } from "./jest";
import { parseTsc } from "./tsc";

/**
 * Dispatches a report task to its parser. M3b wires tsc, eslint and
 * jest/vitest; "Build" stays empty until M4 decides on next-build parsing.
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