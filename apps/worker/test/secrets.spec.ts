import { afterEach, describe, expect, it } from "vitest";
import { clearSecrets, redact, registerSecret, unregisterSecret } from "../src/common/secrets";

describe("secret redaction (.clinerules: never log secrets)", () => {
  afterEach(() => clearSecrets());

  it("masks a registered secret and restores the original after unregister", () => {
    registerSecret("ghs_super_secret_token_value");
    expect(redact("cloning with ghs_super_secret_token_value@github.com")).toBe(
      "cloning with [redacted]@github.com",
    );

    unregisterSecret("ghs_super_secret_token_value");
    expect(redact("ghs_super_secret_token_value")).toBe("ghs_super_secret_token_value");
  });

  it("masks token-shaped strings even when never registered", () => {
    expect(redact("ghs_abcdefghijklmnopqrstuvwxyz012345")).toBe("[redacted-token]");
    expect(redact("github_pat_11ABCDEFG0abcdefghijklmnop")).toBe("[redacted-token]");
  });

  it("ignores values too short to be a real token", () => {
    registerSecret("abc");
    expect(redact("abc")).toBe("abc");
  });
});