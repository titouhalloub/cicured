import { registerSecret, unregisterSecret } from "../common/secrets";
import { mintInstallationToken, type GitHubAppCredentials } from "./token";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Minimal GitHub REST client for the worker (v2 combined pipeline): posts the
 * post-run diagnosis comment back onto the PR. The diff review itself lives in
 * the API (apps/api/src/auth/github.client.ts) — mirrored here only as far as
 * needed, because the worker must never import the NestJS app (Spec §0).
 */
export interface WorkerGitHubClient {
  /**
   * Fetches a bounded source snippet at the exact reviewed commit. The
   * installation token is supplied by the active run and is never logged.
   */
  getFileSnippet(
    owner: string,
    repo: string,
    filePath: string,
    ref: string,
    line: number,
    token: string,
  ): Promise<string>;
  /**
   * Posts a general PR comment through the issues endpoint
   * (`POST /repos/{owner}/{repo}/issues/{prNumber}/comments`) — a normal
   * conversation entry, not an inline review comment.
   */
  postPullRequestComment(
    owner: string,
    repo: string,
    prNumber: number,
    installationId: number,
    body: string,
  ): Promise<void>;
}

export function createGitHubClient(env: GitHubAppCredentials): WorkerGitHubClient {
  return {
    async getFileSnippet(owner, repo, filePath, ref, line, token) {
      const normalized = filePath.replace(/\\/g, "/");
      const segments = normalized.split("/");
      if (
        !normalized ||
        normalized.startsWith("/") ||
        segments.some((segment) => !segment || segment === "." || segment === "..") ||
        !Number.isSafeInteger(line) ||
        line < 1
      ) {
        return "";
      }

      const encodedPath = segments.map(encodeURIComponent).join("/");
      const response = await fetch(
        `${env.GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
        {
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token}`,
            "user-agent": "sft-dev",
            "x-github-api-version": "2022-11-28",
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (response.status === 404) return "";
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`GitHub source read responded ${response.status}: ${text.slice(0, 200)}`);
      }

      const body = (await response.json()) as {
        type?: string;
        encoding?: string;
        size?: number;
        content?: string;
      };
      // Contents API only returns inline base64 for reasonably small files.
      // Large files are deliberately skipped rather than fetched unbounded.
      if (
        body.type !== "file" ||
        body.encoding !== "base64" ||
        typeof body.content !== "string" ||
        (typeof body.size === "number" && body.size > 1_000_000)
      ) {
        return "";
      }

      const source = Buffer.from(body.content.replace(/\\s/g, ""), "base64").toString("utf8");
      const lines = source.split(/\\r?\\n/);
      const firstLine = Math.max(1, line - 20);
      const lastLine = Math.min(lines.length, line + 20);
      return lines
        .slice(firstLine - 1, lastLine)
        .map((text, index) => `${firstLine + index}: ${text}`)
        .join("\\n");
    },
    async postPullRequestComment(owner, repo, prNumber, installationId, body) {
      // Minted per comment (1h TTL, clone-less use); registered so the log
      // masker scrubs it if any line ever carries it (Spec §8: tokens never
      // reach logs, job payloads or DB rows).
      const token = await mintInstallationToken(installationId, env);
      registerSecret(token);
      try {
        const response = await fetch(
          `${env.GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
          {
            method: "POST",
            headers: {
              accept: "application/vnd.github+json",
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "user-agent": "sft-dev",
              "x-github-api-version": "2022-11-28",
            },
            body: JSON.stringify({ body }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `GitHub PR comment responded ${response.status}: ${text.slice(0, 200)}`,
          );
        }
      } finally {
        unregisterSecret(token);
      }
    },
  };
}
