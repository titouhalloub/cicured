import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "../src/github/client";
import type { GitHubAppCredentials } from "../src/github/token";

const env = {
  GITHUB_API_BASE: "https://api.github.com",
} as GitHubAppCredentials;

describe("WorkerGitHubClient.getFileSnippet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes the file at the requested commit and returns bounded numbered context", async () => {
    const source = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(source),
      content: Buffer.from(source, "utf8").toString("base64"),
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createGitHubClient(env);
    const snippet = await client.getFileSnippet(
      "acme",
      "web",
      "src/users.ts",
      "0123456789abcdef",
      50,
      "ghs_test_token",
    );

    expect(snippet.split("\n")).toHaveLength(41);
    expect(snippet.split("\n")[0]).toBe("30: line 30");
    expect(snippet.split("\n").at(-1)).toBe("70: line 70");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/web/contents/src/users.ts?ref=0123456789abcdef",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer ghs_test_token",
          accept: "application/vnd.github+json",
        }),
      }),
    );
  });

  it("refuses absolute and traversal paths without making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = createGitHubClient(env);

    await expect(client.getFileSnippet("acme", "web", "../secrets", "sha", 1, "token"))
      .resolves.toBe("");
    await expect(client.getFileSnippet("acme", "web", "foo/../bar", "sha", 1, "token"))
      .resolves.toBe("");
    await expect(client.getFileSnippet("acme", "web", "foo/./bar", "sha", 1, "token"))
      .resolves.toBe("");
    await expect(client.getFileSnippet("acme", "web", "/etc/passwd", "sha", 1, "token"))
      .resolves.toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clips exceptionally long source lines before they reach the prompt", async () => {
    const source = "x".repeat(5_000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(source),
      content: Buffer.from(source, "utf8").toString("base64"),
    }), { status: 200 })));
    const client = createGitHubClient(env);

    const snippet = await client.getFileSnippet("acme", "web", "src/large.ts", "sha", 1, "token");
    expect(snippet.length).toBeLessThan(700);
    expect(snippet).toContain("[line truncated]");
  });

  it("returns an empty snippet when the file is unavailable at the reviewed commit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const client = createGitHubClient(env);

    await expect(client.getFileSnippet("acme", "web", "src/deleted.ts", "sha", 1, "token"))
      .resolves.toBe("");
  });
});
