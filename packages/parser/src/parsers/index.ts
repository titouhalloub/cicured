import type { SftTaskV2 } from "@sft/schemas";
import type { ParsedFinding } from "../types";
import { PARSERS, TASK_NAME_TO_PARSER } from "./registry";

/**
 * Turns one report task into findings.
 *
 * `task.parser` (Phase 3e) wins over the task-name map: a user-supplied
 * sft-dev.config.json task can pin any registry id (including the config-tier
 * `json` / `regex` parsers, which read `task.parserConfig`) and keep its
 * runtime `command`. Without it, the name mapping decides — unknown names
 * resolve to no findings.
 */
export function parseTask(task: SftTaskV2): ParsedFinding[] {
  try {
    const parserId = task.parser ?? TASK_NAME_TO_PARSER[task.name];
    if (!parserId) return [];
    const parser = PARSERS[parserId];
    if (!parser) return [];
    return parser.parse(task.stdout, task.stderr, task.command ?? "", task.parserConfig);
  } catch {
    return [];
  }
}