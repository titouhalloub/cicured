import { describe, expect, it } from "vitest";
import { CryptoService, parseEncryptionKey } from "../src/common/crypto.service";
import { makeConfig } from "./test-utils";

describe("parseEncryptionKey", () => {
  it("accepts 64-char hex and base64 (32 bytes)", () => {
    const hex = "ab".repeat(32);
    expect(parseEncryptionKey(hex).length).toBe(32);
    const b64 = Buffer.alloc(32, 7).toString("base64");
    expect(parseEncryptionKey(b64).length).toBe(32);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => parseEncryptionKey("short")).toThrow(/32 bytes/);
    expect(() => parseEncryptionKey(Buffer.alloc(31).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("CryptoService (AES-256-GCM for *_enc columns)", () => {
  const crypto = new CryptoService(makeConfig());

  it("round-trips a value", () => {
    const secret = "installation:12345678";
    const payload = crypto.encrypt(secret);
    expect(payload).not.toContain(secret);
    expect(payload.startsWith("v1:")).toBe(true);
    expect(crypto.decrypt(payload)).toBe(secret);
  });

  it("produces a different ciphertext every time (random IV)", () => {
    expect(crypto.encrypt("same")).not.toBe(crypto.encrypt("same"));
  });

  it("detects tampering (auth tag)", () => {
    const payload = crypto.encrypt("installation:1");
    const parts = payload.split(":");
    const tampered = [...parts.slice(0, 3), Buffer.from("tampered").toString("base64")].join(":");
    expect(() => crypto.decrypt(tampered)).toThrow();
  });

  it("rejects a payload from a different key", () => {
    const payload = crypto.encrypt("installation:1");
    const other = makeConfig({
      SFT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    });
    expect(() => new CryptoService(other).decrypt(payload)).toThrow();
  });

  it("rejects malformed payloads", () => {
    expect(() => crypto.decrypt("garbage")).toThrow(/malformed/);
    expect(() => crypto.decrypt("v2:a:b:c")).toThrow(/malformed/);
  });
});
