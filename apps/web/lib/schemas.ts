import type { Finding, Suggestion } from "@sft/schemas";

/**
 * Shared API data shapes (Spec §5/§6). Everything here is (re-)exported from
 * `@sft/schemas` — the single source of truth for cross-package contracts —
 * so the UI can never drift from what the API serializes.
 */
export type { RunSummary, ProjectSummary, RunStatus, Finding, Suggestion } from "@sft/schemas";
export { RUN_STATUSES } from "@sft/schemas";

/**
 * DB row is wider than the wire `Suggestion` schema — the extra fields are the
 * primary key, the foreign key, and the creation timestamp. Kept local to the
 * web app; @sft/schemas/Suggestion stays as the minimal shared shape.
 */
export interface SuggestionWithId extends Suggestion {
  id: string;
  findingId: string;
  createdAt: string; // ISO
}

/**
 * Same story for findings: the wire `Finding` schema carries the fingerprint
 * (which is what dedup and cross-run identity are keyed on) but not the row
 * primary key. Suggestions reference findings by that key, so the run detail
 * page needs it to render `rule_id` on each card.
 */
export interface FindingWithId extends Finding {
  id: string;
}
