import { createSign } from "node:crypto";
import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { RepoSummary } from "@sft/schemas";
import { AppConfig } from "../config/app-config.service";

interface GithubUserResponse {
  id: number;
  login: string;
  email: string | null;
}

interface GithubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GithubRepoResponse {
  id: number;
  full_name: string;
  default_branch: string;
  private: boolean;
}

interface GithubInstallationReposResponse {
  repositories: GithubRepoResponse[];
}

interface GithubInstallationTokenResponse {
  token: string;
}

const APP_JWT_TTL_SECONDS = 540; // GitHub caps app JWTs at 10 minutes.
const REQUEST_TIMEOUT_MS = 15_000;

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
 * GitHub OAuth (user login, Spec §0) + GitHub App (installation tokens for repo
 * access, Spec §4/§8). Access tokens live only for the duration of a call -
 * never logged, persisted or put in job payloads.
 */
@Injectable()
export class GitHubClient {
  constructor(private readonly config: AppConfig) {}

  /** True when the GitHub App credentials are present (Spec §0). */
  get appConfigured(): boolean {
    return this.config.githubAppConfigured;
  }

  assertOAuthConfigured(): void {
    if (!this.config.githubOAuthConfigured) {
      throw new ServiceUnavailableException("GitHub OAuth is not configured");
    }
  }

  assertAppConfigured(): void {
    if (!this.config.githubAppConfigured) {
      throw new ServiceUnavailableException("GitHub App is not configured");
    }
  }

  /** Authorize URL for the browser redirect flow (GET /auth/github). */
  buildAuthorizeUrl(state: string): string {
    this.assertOAuthConfigured();
    const params = new URLSearchParams({
      client_id: this.config.github.clientId ?? "",
      redirect_uri: this.config.github.callbackUrl,
      scope: "read:user user:email",
      state,
    });
    return `${this.config.github.oauthBase}/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<string> {
    this.assertOAuthConfigured();
    const body = await this.requestJson<{ access_token?: string }>(
      `${this.config.github.oauthBase}/login/oauth/access_token`,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: this.config.github.clientId,
          client_secret: this.config.github.clientSecret,
          code,
          redirect_uri: this.config.github.callbackUrl,
        }),
      },
      "GitHub OAuth code exchange",
    );
    if (!body.access_token) {
      throw new BadGatewayException("GitHub OAuth code exchange returned no token");
    }
    return body.access_token;
  }

  async getUser(accessToken: string): Promise<GithubUserResponse> {
    return this.requestJson<GithubUserResponse>(
      `${this.config.github.apiBase}/user`,
      { headers: this.userHeaders(accessToken, "user lookup") },
      "GitHub user lookup",
    );
  }

  /** GitHub hides private emails; fall back to the emails API (primary+verified). */
  async getPrimaryEmail(accessToken: string): Promise<string | null> {
    const emails = await this.requestJson<GithubEmailResponse[]>(
      `${this.config.github.apiBase}/user/emails`,
      { headers: this.userHeaders(accessToken, "email lookup") },
      "GitHub email lookup",
    );
    const primary = emails.find((entry) => entry.primary && entry.verified);
    if (primary) return primary.email;
    return emails.find((entry) => entry.verified)?.email ?? null;
  }

  /** RS256 app JWT - GitHub caps the lifetime at 10 minutes. */
  async createAppJwt(now: number = Date.now()): Promise<string> {
    this.assertAppConfigured();
    const iat = Math.floor(now / 1000) - 60;
    const payload = {
      iat,
      exp: iat + 60 + APP_JWT_TTL_SECONDS,
      iss: this.config.github.appId,
    };
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    const signingInput = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}`;

    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(parsePrivateKeyPem(this.config.github.privateKey ?? ""));
    return `${signingInput}.${signature.toString("base64url")}`;
  }

  /** Installation token: 1h TTL, minted per job, clone + repo listing only (§8). */
  async createInstallationToken(installationId: number): Promise<string> {
    const appJwt = await this.createAppJwt();
    const body = await this.requestJson<GithubInstallationTokenResponse>(
      `${this.config.github.apiBase}/app/installations/${installationId}/access_tokens`,
      { method: "POST", headers: this.appHeaders(appJwt) },
      "GitHub installation token",
    );
    if (!body.token) {
      throw new BadGatewayException("GitHub returned no installation token");
    }
    return body.token;
  }

  /** GET /repos - repositories reachable through one installation (first 100). */
  async listInstallationRepos(installationId: number): Promise<RepoSummary[]> {
    const token = await this.createInstallationToken(installationId);
    const body = await this.requestJson<GithubInstallationReposResponse>(
      `${this.config.github.apiBase}/installation/repositories?per_page=100`,
      { headers: this.userHeaders(token, "repo listing") },
      "GitHub repo listing",
    );
    return body.repositories.map((repo) => ({
      id: repo.id,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      private: repo.private,
    }));
  }

  /** Resolves a repository's default branch (used when POST /projects omits it). */
  async getRepoDefaultBranch(installationId: number, fullName: string): Promise<string> {
    const token = await this.createInstallationToken(installationId);
    const body = await this.requestJson<GithubRepoResponse>(
      `${this.config.github.apiBase}/repos/${fullName}`,
      { headers: this.userHeaders(token, "repo lookup") },
      "GitHub repo lookup",
    );
    return body.default_branch;
  }

  /** GET /repos/{owner}/{repo}/pulls/{n} as a raw unified diff (v3.diff media type). */
  async getPullRequestDiff(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string> {
    const token = await this.createInstallationToken(installationId);
    return this.requestText(
      `${this.config.github.apiBase}/repos/${owner}/${repo}/pulls/${prNumber}`,
      {
        headers: {
          ...this.userHeaders(token, "PR diff"),
          accept: "application/vnd.github.v3.diff",
        },
      },
      "GitHub PR diff",
    );
  }

  /**
   * POST /repos/{owner}/{repo}/pulls/{n}/reviews with inline comments.
   * `position` is the legacy diff offset (lines down from the file's FIRST
   * `@@` hunk header) — still the field the reviews endpoint requires for
   * inline comments. `event: COMMENT` never approves or requests changes.
   */
  async createPullRequestReview(
    installationId: number,
    owner: string,
    repo: string,
    prNumber: number,
    commitSha: string,
    body: string,
    comments: Array<{ path: string; position: number; body: string }>,
  ): Promise<void> {
    const token = await this.createInstallationToken(installationId);
    await this.requestJson<unknown>(
      `${this.config.github.apiBase}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
      {
        method: "POST",
        headers: {
          ...this.userHeaders(token, "PR review"),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          commit_id: commitSha,
          body,
          event: "COMMENT",
          comments,
        }),
      },
      "GitHub PR review",
    );
  }

  private userHeaders(accessToken: string, purpose: string) {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "sft-dev",
      "x-github-api-version": "2022-11-28",
      "x-sft-purpose": purpose,
    };
  }

  private appHeaders(appJwt: string) {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${appJwt}`,
      "user-agent": "sft-dev",
      "x-github-api-version": "2022-11-28",
    };
  }

  private async requestJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network error";
      throw new BadGatewayException(`${label} failed: ${reason}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BadGatewayException(
        `${label} responded ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await response.json()) as T;
  }

  /** Same transport as requestJson but for non-JSON bodies (the PR diff). */
  private async requestText(url: string, init: RequestInit, label: string): Promise<string> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network error";
      throw new BadGatewayException(`${label} failed: ${reason}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BadGatewayException(
        `${label} responded ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    return response.text();
  }
}
