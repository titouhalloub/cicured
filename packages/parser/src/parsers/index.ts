import type { SftTaskV2 } from "@sft/schemas";
import type { ParsedFinding } from "../types";
import { parseTsc } from "./tsc";

/**
 * Dispatches a report task to its parser. M3a handles tsc only; M3b wires
 * eslint and jest/vitest here.
 */
export function parseTask(task: SftTaskV2): ParsedFinding[] {
  try {
    if (task.name === "Type Check") return parseTsc(task.stdout, task.stderr);
    return [];
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}