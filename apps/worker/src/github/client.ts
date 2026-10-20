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
