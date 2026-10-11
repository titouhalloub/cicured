// Default import (not `import * as os`) so tests can `vi.spyOn(os, "homedir")`:
// the CJS module.exports object is mutable, whereas a builtin ESM namespace
// is not.
import os from "node:os";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface Credentials {
  deviceToken: string;
  createdAt: string;
  email: string;
}

export function credentialsPath(): string {
  return path.join(os.homedir(), ".cicured", "credentials");
}

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { deviceToken?: unknown; createdAt?: unknown; email?: unknown };
  return (
    typeof candidate.deviceToken === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.email === "string"
  );
}

export function readCredentials(): Credentials | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath(), "utf8"));
    return isCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCredentials(c: Credentials): void {
  const file = credentialsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const body = `${JSON.stringify(c, null, 2)}\n`;
  if (process.platform === "win32") {
    // POSIX modes do not exist on Windows; ACLs are the only mechanism.
    writeFileSync(file, body, "utf8");
    return;
  }
  writeFileSync(file, body, { encoding: "utf8", mode: 0o600 });
}

export function clearCredentials(): void {
  try {
    rmSync(credentialsPath(), { force: true });
  } catch {
    // Already gone, or not ours to delete.
  }
}
