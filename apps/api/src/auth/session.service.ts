import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { AppConfig } from "../config/app-config.service";

export const SESSION_COOKIE_NAME = "sft_session";
export const OAUTH_STATE_COOKIE_NAME = "sft_oauth_state";

export interface SessionPayload {
  /** User id (uuid). */
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Stateless sessions: `base64url(json) + "." + HMAC-SHA256(secret)` in an
 * httpOnly cookie. §5 defines no sessions table, and the token carries only the
 * user id - no PII, no tokens (Spec §8).
 */
@Injectable()
export class SessionService {
  constructor(private readonly config: AppConfig) {}

  createSessionToken(userId: string, now: number = Date.now()): string {
    const payload: SessionPayload = {
      sub: userId,
      iat: Math.floor(now / 1000),
      exp: Math.floor((now + this.config.sessionTtlMs) / 1000),
    };
    return this.sign(payload);
  }

  verifySessionToken(token: string, now: number = Date.now()): SessionPayload | null {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;

    const expected = this.hmac(encoded);
    const provided = Buffer.from(signature, "base64url");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      return null;
    }

    const payload = this.decode(encoded);
    if (!payload || typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) {
      return null;
    }
    return payload;
  }

  private sign(payload: SessionPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${this.hmac(encoded).toString("base64url")}`;
  }

  private hmac(encoded: string): Buffer {
    return createHmac("sha256", this.config.sessionSecret).update(encoded).digest();
  }

  private decode(encoded: string): SessionPayload | null {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      return parsed as SessionPayload;
    } catch {
      return null;
    }
  }
}
