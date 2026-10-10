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

/**
 * LLM suggestion draft (Spec §6): the raw output from the model before
 * it is persisted with finding metadata. Stricter than Suggestion — the
 * patchDiff must look like a unified diff (contain ---, +++, or @@).
 */
export const SuggestionDraft = z.object({
  patchDiff: z.string().min(1).max(10_000).refine(
    (v) => /^(---|\+\+\+|@@)/m.test(v),
    "patchDiff must look like a unified diff (must contain ---, +++, or @@)",
  ),
  explanation: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
});
export type SuggestionDraft = z.infer<typeof SuggestionDraft>;

/**
 * User feedback on a suggestion (Spec §4 step 11): the accept/reject verdict
 * that closes the loop. `accepted` is a plain boolean — the suggestion row
 * starts with a null `accepted` and this is what fills it in.
 */
export const FeedbackInput = z.object({
  accepted: z.boolean(),
});

export type FeedbackInput = z.infer<typeof FeedbackInput>;
