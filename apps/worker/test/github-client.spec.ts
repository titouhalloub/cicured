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
    const source = ["one", "two", "three", "four", "five"].join("\n");
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
      3,
      "ghs_test_token",
    );

    expect(snippet).toBe("1: one\n2: two\n3: three\n4: four\n5: five");
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
    await expect(client.getFileSnippet("acme", "web", "/etc/passwd", "sha", 1, "token"))
      .resolves.toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty snippet when the file is unavailable at the reviewed commit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const client = createGitHubClient(env);

    await expect(client.getFileSnippet("acme", "web", "src/deleted.ts", "sha", 1, "token"))
      .resolves.toBe("");
  });
});
