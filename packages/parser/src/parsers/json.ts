import type { ParsedFinding } from "../types";
import { capInput, findingLimit, truncatedFinding } from "./caps";
import { stripRepoPrefix } from "./eslint";

type Severity = ParsedFinding["severity"];
type Category = ParsedFinding["category"];

/**
 * Config for the `json` parser (Phase 3e). Every field path is a dot-path into
 * one array item; `path` is a dot-path to the array inside the parsed JSON
 * (`""`/absent = the top level). The config is user-supplied, so it is fully
 * validated at parse time and anything unusable yields no findings.
 */
interface JsonParserConfig {
  path?: string;
  fields: {
    file: string;
    line?: string;
    col?: string;
    message?: string;
    severity?: string;
    ruleId?: string;
  };
  severityMap?: Record<string, Severity>;
  defaultSeverity?: Severity;
  defaultCategory?: Category;
  defaultRuleId?: string;
}

const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];
const CATEGORIES: readonly Category[] = ["build", "typecheck", "lint", "test"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

/** Walks a dot-path (`"a.b.c"`). Returns undefined the moment a step misses. */
function walk(root: unknown, dotPath: string): unknown {
  if (dotPath === "") return root;
  let current: unknown = root;
  for (const key of dotPath.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Coerces a JSON value to a positive integer, falling back when impossible. */
function toInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  if (isString(value) && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10);
  return fallback;
}

function validateConfig(config: unknown): JsonParserConfig | null {
  if (!isRecord(config)) return null;
  const { fields, severityMap, defaultSeverity, defaultCategory, defaultRuleId } = config;
  if (!isRecord(fields) || !isString(fields.file) || fields.file.trim() === "") return null;
  if ("path" in config && config.path !== undefined && !isString(config.path)) return null;
  if (severityMap !== undefined && !isRecord(severityMap)) return null;
  if (defaultSeverity !== undefined && !SEVERITIES.includes(defaultSeverity as Severity)) return null;
  if (defaultCategory !== undefined && !CATEGORIES.includes(defaultCategory as Category)) return null;
  if (defaultRuleId !== undefined && !isString(defaultRuleId)) return null;
  return config as unknown as JsonParserConfig;
}

/**
 * Parses JSON-shaped tool output into findings using a user-supplied field map
 * (Phase 3e). Handles any tool that emits an array of objects — the same
 * contract as ruff/semgrep, but configurable instead of hard-coded.
 *
 * Never throws: a bad config, unparseable JSON, or a missing array all return
 * `[]` (config problems also warn once, since they are the user's to fix).
 */
export function parseJson(
  stdout: string,
  stderr: string,
  command: string,
  config?: unknown,
): ParsedFinding[] {
  const cfg = validateConfig(config);
  if (cfg === null) {
    console.warn("[@sft/parser] json parser config is invalid; skipping");
    return [];
  }
  try {
    const out = capInput(stdout ?? "");
    const err = capInput(stderr ?? "");
    const truncated = out.truncated || err.truncated;
    const limit = findingLimit(truncated);

    let parsed: unknown;
    try {
      parsed = JSON.parse(out.text);
    } catch {
      console.warn("[@sft/parser] json parser input is not valid JSON; skipping");
      return [];
    }

    const items = walk(parsed, cfg.path ?? "");
    if (!Array.isArray(items)) {
      console.warn("[@sft/parser] json parser config path is not an array; skipping");
      return [];
    }

    const severityMap = new Map<string, Severity>();
    for (const [key, value] of Object.entries(cfg.severityMap ?? {})) {
      if (SEVERITIES.includes(value)) severityMap.set(key.toUpperCase(), value);
    }
    const pick = (item: Record<string, unknown>, path: string | undefined): unknown =>
      path === undefined ? undefined : walk(item, path);
    const asText = (value: unknown): string | undefined =>
      isString(value) ? value : typeof value === "number" ? String(value) : undefined;

    const findings: ParsedFinding[] = [];
    for (const raw of items.slice(0, limit)) {
      if (!isRecord(raw)) continue;
      const file = asText(pick(raw, cfg.fields.file));
      const severityText = asText(pick(raw, cfg.fields.severity))?.toUpperCase();
      const severity =
        (severityText !== undefined ? severityMap.get(severityText) : undefined) ??
        cfg.defaultSeverity ??
        "warning";
      findings.push({
        severity,
        category: cfg.defaultCategory ?? "lint",
        ruleId: asText(pick(raw, cfg.fields.ruleId)) ?? cfg.defaultRuleId ?? "custom",
        // Findings store repo-relative files: strip the sandbox prefix and any
        // other leading slash a local run may produce.
        file: stripRepoPrefix(file ?? "<unknown>").replace(/^\//, ""),
        line: toInt(pick(raw, cfg.fields.line), 1),
        col: toInt(pick(raw, cfg.fields.col), 1),
        message: asText(pick(raw, cfg.fields.message))?.trim() || "finding",
      });
    }

    if (truncated) findings.push(truncatedFinding(cfg.defaultCategory ?? "lint"));
    return findings;
  } catch {
    // The parser must never throw on any input.
    return [];
  }
}
