import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/ai/secret-filter";

const AWS_KEY = "AKIAABCDEFGHIJKLMNOP";
const GH_TOKEN = "ghp_" + "A".repeat(24);
const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef123456";

describe("redactSecrets (Spec §7 secret guard)", () => {
  it("redacts an AWS access key id", () => {
    const result = redactSecrets(`deploy failed for ${AWS_KEY} in prod`);
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
    expect(result.cleaned).not.toContain(AWS_KEY);
    expect(result.cleaned).toContain("[REDACTED:aws_key]");
    expect(result.skip).toBe(false);
  });

  it("redacts a GitHub token", () => {
    const result = redactSecrets(`auth header: ${GH_TOKEN}`);
    expect(result.redactionCount).toBeGreaterThanOrEqual(1);
    expect(result.cleaned).not.toContain(GH_TOKEN);
    expect(result.cleaned).toContain("[REDACTED:github_token]");
    expect(result.skip).toBe(false);
  });

  it("redacts a JWT and a generic password assignment without skipping", () => {
    const input = `session=${JWT} and password=hunter2secret`;
    const result = redactSecrets(input);
    expect(result.cleaned).not.toContain(JWT);
    expect(result.cleaned).toContain("[REDACTED:jwt]");
    expect(result.cleaned).toContain("[REDACTED:generic]");
    expect(result.redactionCount).toBe(2);
    expect(result.skip).toBe(false);
  });

  it("leaves clean text unchanged", () => {
    const input = "All tests passed. The build completed successfully.";
    const result = redactSecrets(input);
    expect(result.cleaned).toBe(input);
    expect(result.redactionCount).toBe(0);
    expect(result.skip).toBe(false);
  });

  it("sets skip=true when at least 4 secret-shaped strings are found", () => {
    const contaminated = Array.from({ length: 4 }, (_, i) => `ghp_${String.fromCharCode(66 + i).repeat(24)}`).join(" ");
    const result = redactSecrets(contaminated);
    expect(result.redactionCount).toBeGreaterThanOrEqual(4);
    expect(result.skip).toBe(true);
  });
});
