/**
 * Secret redaction for worker logs.
 *
 * `.clinerules`: "Never put secrets in code, logs, job payloads or DB rows."
 * The token minted for a run is registered for the duration of the job, and
 * token-shaped strings are masked unconditionally, so an accidental log line
 * can never leak a credential. M2b's Redis log tee reuses this same module.
 */
const activeSecrets = new Set<string>();

const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bghs_[A-Za-z0-9]{16,}/g,
  /\bghu_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
];

export function registerSecret(secret: string): void {
  if (secret.length >= 8) activeSecrets.add(secret);
}

export function unregisterSecret(secret: string): void {
  activeSecrets.delete(secret);
}

/** Test-only hook: forget every registered secret. */
export function clearSecrets(): void {
  activeSecrets.clear();
}

export function redact(value: string): string {
  let out = value;
  for (const secret of activeSecrets) {
    out = out.split(secret).join("[redacted]");
  }
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, "[redacted-token]");
  }
  return out;
}

export interface WorkerLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
  /**
   * A child logger starts from a clean slate: it does NOT inherit the parent's
   * scope or bindings. Per-run lines must not be prefixed with boot-only
   * context (`boot queue=sft-runs`). The optional second argument sets a new
   * scope for the child, e.g. `logger.child({ runId }, "task")`.
   */
  child(bindings: Record<string, string>, scope?: string): WorkerLogger;
}

function renderBindings(bindings: Record<string, string>): string {
  const entries = Object.entries(bindings).filter(([, value]) => value !== "");
  return entries.length === 0 ? "" : ` ${entries.map(([k, v]) => `${k}=${v}`).join(" ")}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLogger(
  scope?: string,
  bindings: Record<string, string> = {},
): WorkerLogger {
  const suffix = renderBindings(bindings);
  // A missing scope must not leave a double space after the [sft-worker] tag.
  const prefix = scope ? `[sft-worker] ${scope}` : "[sft-worker]";
  const line = (message: string): string => redact(`${prefix}${suffix} ${message}`);
  return {
    info(message) {
      console.log(line(message));
    },
    warn(message, error) {
      console.warn(
        line(error === undefined ? message : `${message}: ${errorMessage(error)}`));
    },
    error(message, error) {
      console.error(line(error === undefined ? message : `${message}: ${errorMessage(error)}`));
    },
    child(bindings, childScope) {
      // Fresh context: no parent scope, no parent bindings.
      return createLogger(childScope, bindings);
    },
  };
}