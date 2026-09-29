import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.service";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

/** Accepts a 32-byte key as base64 or as 64 hex characters. */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, "hex");
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) return decoded;
  throw new Error("SFT_ENCRYPTION_KEY must be 32 bytes (base64) or 64-char hex");
}

/**
 * AES-256-GCM for at-rest secret columns (`projects.installation_id_enc`,
 * `project_env_vars.value_enc`). Format: `v1:<iv>:<tag>:<ciphertext>` base64.
 * Envelope encryption via KMS/Vault is post-MVP (Spec §13).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: AppConfig) {
    this.key = parseEncryptionKey(config.encryptionKey);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(":");
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
      throw new Error("malformed encrypted payload");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
