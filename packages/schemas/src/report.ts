import { z } from "zod";
import { isIsoDateTime } from "./common";

/**
 * Size caps applied by the deterministic parser (Spec §2 "the parser
 * additionally caps ..."). Kept here so parser + API share one source.
 */
export const PARSER_LIMITS = {
  /** Serialized `sft-report.json` bytes accepted by the parser. */
  maxReportBytes: 2 * 1024 * 1024,
  /** Per-task stdout/stderr characters accepted after zod validation. */
  maxTaskStreamChars: 200_000,
  /** Findings persisted / sent to the LLM per run. */
  maxFindingsPerRun: 50,
} as const;

const isoDateTime = z
  .string()
  .refine(isIsoDateTime, { message: "must be a valid ISO-8601 timestamp" });

/** One task entry of `sft-report.json` schema v2 (pinned runner, Spec §2). */
export const SftTaskV2 = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  success: z.boolean(),
  /** `null` for skipped tasks (global deadline exhausted). */
  exitCode: z.number().int().nullable(),
  timedOut: z.boolean(),
  skipped: z.boolean(),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
  stdout: z.string().max(PARSER_LIMITS.maxTaskStreamChars),
  stderr: z.string().max(PARSER_LIMITS.maxTaskStreamChars),
});

export const SftSummaryV2 = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
});

/**
 * Canonical run artifact consumed by the parser — not raw text (Spec §2).
 * The runner contract keeps version 2 and only adds fields, so unknown keys
 * are tolerated (zod strips them) instead of rejected.
 */
export const SftReportV2 = z.object({
  tool: z.literal("sft-dev"),
  version: z.literal(2),
  finishedAt: isoDateTime,
  runnerError: z.string().nullable(),
  warnings: z.array(z.string()),
  summary: SftSummaryV2,
  tasks: z.array(SftTaskV2),
});

export type SftReportV2 = z.infer<typeof SftReportV2>;
export type SftTaskV2 = z.infer<typeof SftTaskV2>;
export type SftSummaryV2 = z.infer<typeof SftSummaryV2>;

export type ParseSftReportResult =
  | { ok: true; report: SftReportV2 }
  | { ok: false; error: string };

/**
 * Validates untrusted report input (string | unknown JSON) against schema v2
 * and enforces the parser byte cap. Never throws.
 */
export function parseSftReport(input: unknown): ParseSftReportResult {
  if (typeof input === "string") {
    const bytes = Buffer.byteLength(input, "utf8");
    if (bytes > PARSER_LIMITS.maxReportBytes) {
      return {
        ok: false,
        error: `report exceeds ${PARSER_LIMITS.maxReportBytes} bytes (got ${bytes})`,
      };
    }
    try {
      input = JSON.parse(input);
    } catch (error) {
      return { ok: false, error: `report is not valid JSON: ${String(error)}` };
    }
  }

  const parsed = SftReportV2.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { ok: true, report: parsed.data };
}
