/**
 * Internal shape produced by every parser — the `Finding` zod schema minus
 * `fingerprint`, which is computed after parsing (Spec §5).
 */
export interface ParsedFinding {
  severity: "error" | "warning" | "info";
  category: "build" | "typecheck" | "lint" | "test";
  ruleId: string;
  file: string;
  line: number;
  col: number;
  message: string;
}