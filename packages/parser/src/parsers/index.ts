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
    if (task.skipped) return [];

    // Structured findings are produced by the runner for machine-readable
    // outputs (notably Semgrep) so large JSON documents never need to fit in
    // the bounded stdout field.
    if (task.structuredFindings !== undefined) return task.structuredFindings;

    const parserId = task.parser ?? TASK_NAME_TO_PARSER[task.name];
    if (!parserId) return [];
    if (parserId === "semgrep" && task.truncated && !task.skipped) {
      return [{
        severity: "warning",
        category: "lint",
        ruleId: "sft-semgrep-output-truncated",
        file: "sft-dev:semgrep",
        line: 0,
        col: 0,
        message: "Semgrep output was truncated before parsing; security findings may be incomplete.",
      }];
    }
    const parser = PARSERS[parserId];
    if (!parser) return [];
    return parser.parse(task.stdout, task.stderr, task.command ?? "", task.parserConfig);
  } catch {
    return [];
  }
}