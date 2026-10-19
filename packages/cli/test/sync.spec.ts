import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LlmCallRecord } from "@sft/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCommand } from "../src/commands/sync";
import { clearCredentials, writeCredentials, type Credentials } from "../src/storage/credentials";
import { appendLlmCall, readLlmCalls } from "../src/storage/ledger";

let home: string;
let cwd: string;
let fetchMock: ReturnType<typeof vi.fn<(url: string, init: RequestInit) => Promise<Response>>>;

const creds: Credentials = {
  deviceToken: "tok_test_abc123",
  createdAt: "2026-01-01T00:00:00.000Z",
  email: "dev@example.com",
};

const record: LlmCallRecord = {
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  mode: "explain",
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    source: "reported",
  },
  pricing: { inputPerM: 3, outputPerM: 15 },
  totalCostUsd: 0.00105,
  durationMs: 1234,
};

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), "sft-sync-home-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "sft-sync-cwd-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("SFT_API_URL", "http://api.test");
  writeCredentials(creds);

  fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
  vi.stubGlobal("fetch", fetchMock);

  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("syncCommand", () => {
  it("uploads the ledger with the bearer token and clears it", async () => {
    appendLlmCall(record, cwd);
    appendLlmCall({ ...record, model: "gpt-4o" }, cwd);

    const code = await syncCommand([], cwd);
    expect(code).toBe(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/usage/llm-calls");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: `Bearer ${creds.deviceToken}` });

    const body = JSON.parse(String(init.body)) as { records: LlmCallRecord[] };
    expect(body.records).toHaveLength(2);
    expect(body.records[0]?.model).toBe("claude-sonnet-4-5");

    expect(readLlmCalls(cwd)).toHaveLength(0);
    expect(existsSync(path.join(cwd, ".sft", "llm-calls.jsonl"))).toBe(true);
  });

  it("keeps the ledger when --keep is passed", async () => {
    appendLlmCall(record, cwd);

    const code = await syncCommand(["--keep"], cwd);
    expect(code).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(readLlmCalls(cwd)).toHaveLength(1);
  });

  it("keeps the ledger and fails on an HTTP error", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    appendLlmCall(record, cwd);

    const code = await syncCommand([], cwd);
    expect(code).toBe(1);
    expect(readLlmCalls(cwd)).toHaveLength(1);
  });

  it("keeps the ledger when the API is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    appendLlmCall(record, cwd);

    const code = await syncCommand([], cwd);
    expect(code).toBe(1);
    expect(readLlmCalls(cwd)).toHaveLength(1);
  });

  it("does nothing when the ledger is empty", async () => {
    const code = await syncCommand([], cwd);
    expect(code).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails when the user is not logged in", async () => {
    clearCredentials();
    appendLlmCall(record, cwd);

    const code = await syncCommand([], cwd);
    expect(code).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readLlmCalls(cwd)).toHaveLength(1);
  });
});
