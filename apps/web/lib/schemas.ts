/**
 * Shared API data shapes (Spec §5/§6). Everything here is (re-)exported from
 * `@sft/schemas` — the single source of truth for cross-package contracts —
 * so the UI can never drift from what the API serializes.
 */
export type { RunSummary, ProjectSummary, RunStatus, Finding, Suggestion } from "@sft/schemas";
export { RUN_STATUSES } from "@sft/schemas";
