/** Kinds of secret-shaped strings redactSecrets can mask. */
export type RedactionType =
  | "aws_key"
  | "aws_secret"
  | "github_token"
  | "stripe_key"
  | "slack_token"
  | "google_api_key"
  | "jwt"
  | "generic";

export interface FilterResult {
  cleaned: string;
  redactionCount: number;
  skip: boolean;
}

/**
 * Redact secret-shaped strings from a finding message or code snippet.
 * If redactionCount >= 4 (at least 4 distinct matches), set skip = true
 * so the caller does NOT send that finding to the LLM.
 */
export function redactSecrets(input: string): FilterResult {
  let redactionCount = 0;
  let cleaned = input;

  /**
   * Replace every match of `regex` with a placeholder, counting hits.
   * `String.replace` rescans from the start of each match, so replacements
   * never shift later matches the way a manual `exec` loop does — a run of
   * 4 same-kind tokens still counts all 4.
   */
  const redactAll = (pattern: RegExp, kind: RedactionType): void => {
    cleaned = cleaned.replace(pattern, () => {
      redactionCount += 1;
      return `[REDACTED:${kind}]`;
    });
  };

  // AWS Access Key ID
  redactAll(/\bAKIA[0-9A-Z]{16}\b/g, "aws_key");

  // AWS Secret Key (heuristic: 40 alphanumeric/+/= chars)
  redactAll(/(?<=aws_secret_access_key\s*[=:]?\s*)[A-Za-z0-9/+=]{40}/gi, "aws_secret");

  // GitHub PAT
  redactAll(/\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/g, "github_token");

  // GitHub fine-grained PAT
  redactAll(/\bgithub_pat_[A-Za-z0-9_]{80,}\b/g, "github_token");

  // Stripe Live key
  redactAll(/\bsk_live_[A-Za-z0-9]{24,}\b/g, "stripe_key");

  // Slack token
  redactAll(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, "slack_token");

  // Google API key
  redactAll(/\bAIza[0-9A-Za-z_-]{35}\b/g, "google_api_key");

  // JWT pattern
  redactAll(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    "jwt",
  );

  // Generic password/secret pattern
  redactAll(
    /\b(password|passwd|pwd|secret|api_key|api_token)[\s=:]{1,}['"]?[^\s'"]*[ '"]?/gi,
    "generic",
  );

  const skip = redactionCount >= 4;

  return {
    cleaned,
    redactionCount,
    skip,
  };
}
