import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCredentials,
  credentialsPath,
  readCredentials,
  writeCredentials,
  type Credentials,
} from "../src/storage/credentials";

let home: string;

const creds: Credentials = {
  deviceToken: "tok_abc123",
  createdAt: "2026-01-01T00:00:00.000Z",
  email: "dev@example.com",
};

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "sft-creds-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe("credentials", () => {
  it("round-trips written credentials", () => {
    writeCredentials(creds);
    expect(readCredentials()).toEqual(creds);
  });

  it("returns null when the file is missing", () => {
    expect(readCredentials()).toBeNull();
  });

  it("returns null when the file is corrupt", () => {
    mkdirSync(path.dirname(credentialsPath()), { recursive: true });
    writeFileSync(credentialsPath(), "{ not json", "utf8");
    expect(readCredentials()).toBeNull();
  });

  it("returns null when the shape is wrong", () => {
    mkdirSync(path.dirname(credentialsPath()), { recursive: true });
    writeFileSync(credentialsPath(), JSON.stringify({ deviceToken: 42 }), "utf8");
    expect(readCredentials()).toBeNull();
  });

  it("clearCredentials removes the file", () => {
    writeCredentials(creds);
    expect(existsSync(credentialsPath())).toBe(true);
    clearCredentials();
    expect(existsSync(credentialsPath())).toBe(false);
  });
});

