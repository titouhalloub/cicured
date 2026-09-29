/** Small shared primitives for the schema package (kept dependency-free). */

/** Canonical UUID format (any version; gen_random_uuid() yields v4). */
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** sha256 hex digest, used for fingerprints and payload hashes (Spec §5/§8). */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * ISO-8601 timestamp validation without relying on zod-version-specific
 * datetime helpers; the API always serialises with `Date.prototype.toISOString`.
 */
export function isIsoDateTime(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}
