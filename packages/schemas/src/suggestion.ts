import { z } from "zod";

/**
 * LLM output contract (Spec §7): schema-validated, unified-diff patches —
 * never prose-only, and never auto-applied in the MVP.
 */
export const Suggestion = z.object({
  /** Model identifier, e.g. read from env by the AI service (never hard-coded). */
  model: z.string().min(1).max(200),
  /** Prompt template version used for the LLM cache key (Spec §7). */
  promptVersion: z.string().min(1).max(100),
  /** Unified diff anchored to the finding fingerprint. */
  patchDiff: z.string().min(1).max(200_000),
  explanation: z.string().min(1).max(20_000),
  confidence: z.number().min(0).max(1),
  /** Null until the user accepts/rejects (feedback loop, Spec §4 step 11). */
  accepted: z.boolean().nullable(),
});

export type Suggestion = z.infer<typeof Suggestion>;
