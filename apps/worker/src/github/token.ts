import { createSign } from "node:crypto";
import type { WorkerEnv } from "../env";

/** GitHub caps app JWTs at 10 minutes. */
const APP_JWT_TTL_SECONDS = 540;
/** Backdate `iat` so small clock skews do not invalidate the JWT. */
const CLOCK_SKEW_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 15_000;

export type GitHubAppCredentials = Pick<
  WorkerEnv,
  "GITHUB_APP_ID" | "GITHUB_APP_PRIVATE_KEY"
> & Pick<WorkerEnv, "GITHUB_API_BASE">;

/** Normalizes a PEM that is either inline or base64-encoded in one env var. */
export function parsePrivateKeyPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed.replace(/\\n/g, "\n");
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (!decoded.includes("-----BEGIN")) {
    throw new Error("GITHUB_APP_PRIVATE_KEY must be a PEM (raw or base64-encoded)");
  }
  return decoded;
}

/**
 * RS256 app JWT - mirrored from apps/api/src/auth/github.client.ts so the
 * worker never has to import the API app (Spec §0: the API is a NestJS service).
 */
export function buildAppJwt(
  env: GitHubAppCredentials,
  now: number = Date.now(),
): string {
  const iat = Math.floor(now / 1000) - CLOCK_SKEW_SECONDS;
  const payload = {
    iat,
    exp: iat + CLOCK_SKEW_SECONDS + APP_JWT_TTL_SECONDS,
    iss: env.GITHUB_APP_ID,
  };
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const signingInput = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}`;

  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(parsePrivateKeyPem(env.GITHUB_APP_PRIVATE_KEY));
  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Mints a GitHub App installation token for one run (1h TTL, clone only,
 * Spec §8). The token is returned to the caller and nowhere else: it is never
 * persisted, never put in a job payload and never logged (see common/secrets).
 */
export async function mintInstallationToken(
  installationId: number,
  env: GitHubAppCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new Error("installationId must be a positive integer");
  }
  const appJwt = buildAppJwt(env);

  let response: Response;
  try {
    response = await fetchImpl(
      `${env.GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${appJwt}`,
          "user-agent": "sft-dev",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "network error";
    throw new Error(`GitHub installation token request failed: ${reason}`, { cause: error });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GitHub installation token responded ${response.status}: ${text.slice(0, 200)}`);
  }

  const body = (await response.json()) as { token?: string };
  if (!body.token) {
    throw new Error("GitHub returned no installation token");
  }
  return body.token;
}