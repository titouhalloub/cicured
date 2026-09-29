import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SessionService } from "../src/auth/session.service";
import { makeConfig } from "./test-utils";

const USER_ID = "6f1c9a54-6f0e-4a25-9a8b-1c2d3e4f5a6b";

describe("SessionService (stateless HMAC session cookies)", () => {
  const sessions = new SessionService(makeConfig());

  it("mints and verifies a session token", () => {
    const token = sessions.createSessionToken(USER_ID);
    const payload = sessions.verifySessionToken(token);
    expect(payload?.sub).toBe(USER_ID);
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0);
  });

  it("rejects a tampered payload", () => {
    const token = sessions.createSessionToken(USER_ID);
    const [encoded, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ sub: "attacker", iat: 0, exp: 9_999_999_999 }),
      "utf8",
    ).toString("base64url");
    expect(sessions.verifySessionToken(`${forged}.${signature}`)).toBeNull();
    expect(encoded).toBeDefined();
  });

  it("rejects a tampered signature and malformed tokens", () => {
    const token = sessions.createSessionToken(USER_ID);
    expect(sessions.verifySessionToken(`${token}x`)).toBeNull();
    expect(sessions.verifySessionToken("not-a-token")).toBeNull();
    expect(sessions.verifySessionToken("")).toBeNull();
  });

  it("rejects an expired token", () => {
    const issuedAt = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago, TTL is 7
    const token = sessions.createSessionToken(USER_ID, issuedAt);
    expect(sessions.verifySessionToken(token)).toBeNull();
    expect(sessions.verifySessionToken(token, issuedAt + 60_000)?.sub).toBe(USER_ID);
  });

  it("rejects tokens signed with a different secret", () => {
    const other = new SessionService(
      makeConfig({ SESSION_SECRET: "another-secret-0123456789abcdefghijklmnop" }),
    );
    const token = other.createSessionToken(USER_ID);
    expect(sessions.verifySessionToken(token)).toBeNull();
  });

  it("rejects a payload without a subject", () => {
    const config = makeConfig();
    const encoded = Buffer.from(
      JSON.stringify({ sub: "", iat: 0, exp: 9_999_999_999 }),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", config.sessionSecret)
      .update(encoded)
      .digest("base64url");
    expect(new SessionService(config).verifySessionToken(`${encoded}.${signature}`)).toBeNull();
  });
});
