import type { ParsedFinding } from "../types";
import { parseEslint } from "./eslint";
import { parseGoTest } from "./go-test";
import { parseGoVet } from "./go-vet";
import { parseJest } from "./jest";
import { parseJson } from "./json";
import { parsePytest } from "./pytest";
import { parseRuff } from "./ruff";
import { parseSemgrep } from "./semgrep";
import { parseTsc } from "./tsc";

/**
 * A parser turns raw task output into structured findings.
 *
 * The interface is intentionally minimal — two strings in, findings out
 * (`command` is reserved for parsers that need it; none do yet). Config-tier
 * parsers (Phase 3e) will extend this with a `config` field, but the core
 * contract stays the same: no I/O, no side effects, never throws.
 */
export interface Parser {
  id: string;
  parse(
    stdout: string,
    stderr: string,
    command: string,
    config?: unknown,
  ): ParsedFinding[];
}

/**
 * Parser registry — the single source of truth for what a task name resolves
 * to.
 *
 * Adding a language: add an entry here. Nothing else changes. Adding a
 * config-tier parser: same, but the `parse` will read from a config field.
 */
export const PARSERS: Record<string, Parser> = {
  tsc: { id: "tsc", parse: parseTsc },
  eslint: { id: "eslint", parse: parseEslint },
  jest: { id: "jest", parse: parseJest },
  // vitest shares the jest parser: jest.ts already understands both the jest
  // (`FAIL` + `●`) and vitest (`❯` + `×`) summary formats.
  vitest: { id: "vitest", parse: parseJest },
  pytest: { id: "pytest", parse: parsePytest },
  ruff: { id: "ruff", parse: parseRuff },
  "go-test": { id: "go-test", parse: parseGoTest },
  "go-vet": { id: "go-vet", parse: parseGoVet },
  semgrep: { id: "semgrep", parse: parseSemgrep },
  // Config tier (Phase 3e): no name mapping — these are only reachable through
  // an explicit `task.parser` on a user-supplied sft-dev.config.json task.
  json: { id: "json", parse: parseJson },
};

/**
 * Task-name to parser-id fallback, for tasks the runner auto-detects.
 * Config-tier tasks (Phase 3e) will carry an explicit `parser` field and
 * bypass this map.
 */
export const TASK_NAME_TO_PARSER: Record<string, string> = {
  "Type Check": "tsc",
  Lint: "eslint",
  "Tests": "jest",
  "Python Tests": "pytest",
  "Python Lint": "ruff",
  "Go Tests": "go-test",
  "Go Vet": "go-vet",
  "Security": "semgrep",
};