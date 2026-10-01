import { createDecipheriv } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

/**
 * AES-256-GCM for at-rest secret columns, mirrored from
 * apps/api/src/common/crypto.service.ts so the worker can decrypt
 * `projects.installation_id_enc` with the same SFT_ENCRYPTION_KEY (Spec §5).
 * The API is not refactored; this is a deliberate copy of the format:
 * `v1:<iv>:<tag>:<ciphertext>`, all base64.
 */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("SFT_ENCRYPTION_KEY must be 32 bytes (base64) or 64-char hex");
}

export function decryptSecret(key: Buffer, payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("malformed encrypted payload");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Mirrors ProjectsService.installationIdOf: decrypt, then validate. */
export function decryptInstallationId(encryptionKey: string, payload: string): number {
  const parsed = Number(decryptSecret(parseEncryptionKey(encryptionKey), payload));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("stored installation id is invalid");
  }
  return parsed;
}