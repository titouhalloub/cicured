import type { SftTaskV2 } from "@sft/schemas";
import type { ParsedFinding } from "../types";
import { PARSERS, TASK_NAME_TO_PARSER } from "./registry";

export function parseTask(task: SftTaskV2): ParsedFinding[] {
  try {
    const parserId = TASK_NAME_TO_PARSER[task.name];
    if (!parserId) return [];
    const parser = PARSERS[parserId];
    if (!parser) return [];
    return parser.parse(task.stdout, task.stderr, "");
  } catch {
    return [];
  }
}