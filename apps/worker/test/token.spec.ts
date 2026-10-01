import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildAppJwt, mintInstallationToken } from "../src/github/token";
import { makeEnv } from "./test-utils";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

const NOW = 1_760_000_000_000;

function env() {
  return makeEnv({
    GITHUB_APP_ID: "4242",
    GITHUB_APP_PRIVATE_KEY: PRIVATE_PEM,
    GITHUB_API_BASE: "https://api.github.com",
  });
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("buildAppJwt", () => {
  it("emits a verifiable RS256 JWT with the app id as issuer", () => {
    const jwt = buildAppJwt(env(), NOW);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const [header, payload, signature] = parts;
    expect(decodeSegment(header!)).toEqual({ alg: "RS256", typ: "JWT" });

    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    expect(verifier.verify(PUBLIC_PEM, Buffer.from(signature!, "base64url"))).toBe(true);
  });

  it("backdates iat and expires 10 minutes out (GitHub's cap)", () => {
    const claims = decodeSegment(buildAppJwt(env(), NOW).split(".")[1]!);
    const iat = Math.floor(NOW / 1000) - 60;
    expect(claims.iss).toBe("4242");
    expect(claims.iat).toBe(iat);
    expect(claims.exp).toBe(iat + 60 + 540);
  });

  it("accepts a base64-encoded PEM, like the API does", () => {
    const base64 = Buffer.from(PRIVATE_PEM, "utf8").toString("base64");
    const jwt = buildAppJwt(makeEnv({ GITHUB_APP_PRIVATE_KEY: base64 }), NOW);
    expect(jwt.split(".")).toHaveLength(3);
  });
});

describe("mintInstallationToken", () => {
  it("POSTs to the installation endpoint with the app JWT and returns the token", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ token: "ghs_installationtoken" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const token = await mintInstallationToken(99, env());

    expect(token).toBe("ghs_installationtoken");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/app/installations/99/access_tokens");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(headers["x-github-api-version"]).toBe("2022-11-28");
  });

  it("throws when GitHub answers with an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad credentials", { status: 401 })),
    );
    await expect(mintInstallationToken(99, env())).rejects.toThrow(/responded 401/);
  });

  it("rejects a malformed installation id before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(mintInstallationToken(0, env())).rejects.toThrow(/positive integer/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});