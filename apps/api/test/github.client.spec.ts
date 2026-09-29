import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient, parsePrivateKeyPem } from "../src/auth/github.client";
import { makeConfig } from "./test-utils";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parsePrivateKeyPem", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----";

  it("accepts raw PEM and escaped newlines", () => {
    expect(parsePrivateKeyPem(pem)).toContain("BEGIN RSA PRIVATE KEY");
    expect(parsePrivateKeyPem(pem.replace(/\n/g, "\\n"))).toContain("\n");
  });

  it("accepts base64-encoded PEM", () => {
    expect(parsePrivateKeyPem(Buffer.from(pem).toString("base64"))).toContain("BEGIN");
  });

  it("rejects anything that is not a PEM", () => {
    expect(() => parsePrivateKeyPem("not-a-key")).toThrow(/PEM/);
  });
});

describe("GitHubClient (fetch mocked)", () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  const client = () => {
    vi.stubGlobal("fetch", fetchMock);
    return new GitHubClient(
      makeConfig({
        GITHUB_CLIENT_ID: "client-id",
        GITHUB_CLIENT_SECRET: "client-secret",
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: "inline-key",
      }),
    );
  };

  it("exchanges an OAuth code for a token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "gho_token" }));
    const token = await client().exchangeCode("the-code");
    expect(token).toBe("gho_token");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(init.method).toBe("POST");
    const sent = JSON.parse(String(init.body)) as Record<string, string>;
    expect(sent).toMatchObject({
      client_id: "client-id",
      client_secret: "client-secret",
      code: "the-code",
    });
  });

  it("fails when the exchange returns no token", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "bad_verification_code" }));
    await expect(client().exchangeCode("bad")).rejects.toMatchObject({ status: 502 });
  });

  it("sends the user token as a Bearer header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 1, login: "octocat", email: null }));
    const profile = await client().getUser("gho_token");
    expect(profile.login).toBe("octocat");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer gho_token");
  });

  it("prefers the primary verified email and falls back to any verified one", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { email: "secondary@example.com", primary: false, verified: true },
        { email: "primary@example.com", primary: true, verified: true },
      ]),
    );
    expect(await client().getPrimaryEmail("t")).toBe("primary@example.com");

    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { email: "unverified@example.com", primary: true, verified: false },
        { email: "verified@example.com", primary: false, verified: true },
      ]),
    );
    expect(await client().getPrimaryEmail("t")).toBe("verified@example.com");

    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    expect(await client().getPrimaryEmail("t")).toBeNull();
  });

  it("builds an authorize URL with state and callback", () => {
    const url = new URL(client().buildAuthorizeUrl("state-123"));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:4000/auth/github/callback",
    );
  });

  it("fails with 503 when GitHub credentials are missing", () => {
    vi.stubGlobal("fetch", fetchMock);
    const unconfigured = new GitHubClient(makeConfig());
    expect(() => unconfigured.buildAuthorizeUrl("s")).toThrow(/not configured/);
    expect(() => unconfigured.assertAppConfigured()).toThrow(/not configured/);
  });

  it("creates a verifiable RS256 app JWT", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const github = new GitHubClient(
      makeConfig({
        GITHUB_APP_ID: "12345",
        GITHUB_APP_PRIVATE_KEY: Buffer.from(pem).toString("base64"),
      }),
    );

    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    const jwt = await github.createAppJwt(now);
    const [header, payload, signature] = jwt.split(".");

    const decodedHeader: unknown = JSON.parse(
      Buffer.from(header ?? "", "base64url").toString("utf8"),
    );
    expect(decodedHeader).toEqual({ alg: "RS256", typ: "JWT" });

    const decodedPayload = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    ) as { iss: string; iat: number; exp: number };
    expect(decodedPayload.iss).toBe("12345");
    expect(decodedPayload.exp - decodedPayload.iat).toBe(600);

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(publicKey, Buffer.from(signature ?? "", "base64url"))).toBe(true);
  });

  it("mints an installation token and lists repos", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const github = new GitHubClient(
      makeConfig({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }),
    );
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce(jsonResponse({ token: "ghs_installation" }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        repositories: [
          { id: 5, full_name: "acme/web", default_branch: "develop", private: true },
        ],
      }),
    );

    const repos = await github.listInstallationRepos(42);
    expect(repos).toEqual([
      { id: 5, fullName: "acme/web", defaultBranch: "develop", private: true },
    ]);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.github.com/app/installations/42/access_tokens");
    expect(tokenInit.method).toBe("POST");

    const [reposUrl, reposInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(reposUrl).toBe("https://api.github.com/installation/repositories?per_page=100");
    expect((reposInit.headers as Record<string, string>).authorization).toBe(
      "Bearer ghs_installation",
    );
  });

  it("maps GitHub errors and network failures to 502 without leaking tokens", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Bad credentials", { status: 401 }));
    const error: unknown = await client()
      .getUser("gho_secret_token")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502 });
    expect(String(error)).not.toContain("gho_secret_token");

    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(client().getUser("t")).rejects.toMatchObject({ status: 502 });
  });

  it("resolves a repo default branch through the installation token", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
    const github = new GitHubClient(
      makeConfig({ GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: pem }),
    );
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: "ghs_x" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ default_branch: "trunk" }));
    expect(await github.getRepoDefaultBranch(7, "acme/web")).toBe("trunk");
  });
});
