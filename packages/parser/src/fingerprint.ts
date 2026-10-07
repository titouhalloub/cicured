import { createHash } from "node:crypto";
import type { ParsedFinding } from "./types";

/**
 * Line bucket: `Math.floor(line / 5) * 5`. Bucketed so minor line moves
 * between runs do not invalidate cross-run dedup (Spec §5).
 */
export function bucketLine(line: number): number {
  return Math.floor(line / 5) * 5;
}

/**
 * Message normalization for fingerprints: trimmed, internal whitespace
 * collapsed to single spaces, digit runs replaced with `#` — so
 * `Property 'x' at line 42` and `... line 43` fingerprint identically.
 */
export function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").replace(/\d+/g, "#");
}

/**
 * `fingerprint = sha256(rule_id ‖ file ‖ line-bucket ‖ message-normalized)`
 * — 64-char lowercase hex (Spec §5). Locked: changing this invalidates
 * cross-run diffs and the LLM cache keys.
 */
export function computeFingerprint(finding: ParsedFinding): string {
  const material =
    finding.ruleId +
    finding.file +
    String(bucketLine(finding.line)) +
    normalizeMessage(finding.message);
  return createHash("sha256").update(material, "utf8").digest("hex");
}