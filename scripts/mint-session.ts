import { createHmac } from "node:crypto";

/**
 * Mints a session cookie for the M2b-1 hand-test, because there is no browser
 * OAuth flow on a terminal. The format is byte-identical to what
 * apps/api/src/auth/session.service.ts emits:
 *
 *   base64url(JSON({ sub, iat, exp })) + "." + base64url(HMAC-SHA256(secret))
 *
 * This script only mirrors that format; it never changes the API's auth code.
 *
 * Usage (from the repo root — there is no `tsx` binary at the root, so it is
 * run through a package that has one):
 *   SESSION_SECRET=... pnpm --filter @sft/api exec tsx ../../scripts/mint-session.ts <userId>
 */
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 168);
const userId = process.argv[2];

if (!SESSION_SECRET) {
  console.error("SESSION_SECRET is required");
  process.exit(1);
}
if (!userId) {
  console.error("usage: mint-session.ts <userId>");
  process.exit(1);
}

const now = Date.now();
const payload = {
  sub: userId,
  iat: Math.floor(now / 1000),
  exp: Math.floor((now + SESSION_TTL_HOURS * 3600 * 1000) / 1000),
};

const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signature = createHmac("sha256", SESSION_SECRET).update(encoded).digest("base64url");

// Single line on stdout, so it can be captured with $(...).
console.log(`${encoded}.${signature}`);