import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { LlmCallRecord } from "@sft/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest } from "../src/auth/authenticated-request";
import { DeviceTokenGuard } from "../src/auth/device-token.guard";
import type { SessionGuard } from "../src/auth/session.guard";
import type { Database, UserRow } from "../src/db";
import { UsageService, type SyncLlmCall } from "../src/usage/usage.service";
import type { UsersService } from "../src/users/users.service";

const TOKEN = "dev-token-0123456789abcdef";
const EMAIL = "dev@example.com";

const user = { id: "22222222-2222-4222-8222-222222222222" } as UserRow;

function makeContext(headers: Record<string, string>): {
  guard: DeviceTokenGuard;
  context: ExecutionContext;
  request: AuthenticatedRequest;
  users: { findByEmail: ReturnType<typeof vi.fn> };
  sessionGuard: { canActivate: ReturnType<typeof vi.fn> };
} {
  const request = { headers } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const users = { findByEmail: vi.fn<(email: string) => Promise<UserRow | null>>() };
  const sessionGuard = { canActivate: vi.fn<() => Promise<boolean>>() };
  const guard = new DeviceTokenGuard(
    users as unknown as UsersService,
    sessionGuard as unknown as SessionGuard,
  );
  return { guard, context, request, users, sessionGuard };
}

describe("DeviceTokenGuard", () => {
  beforeEach(() => {
    vi.stubEnv("SFT_DEVICE_TOKEN", TOKEN);
    vi.stubEnv("SFT_DEVICE_TOKEN_EMAIL", EMAIL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts a matching bearer token and attaches the resolved user", async () => {
    const h = makeContext({ authorization: `Bearer ${TOKEN}` });
    h.users.findByEmail.mockResolvedValue(user);

    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.users.findByEmail).toHaveBeenCalledWith(EMAIL);
    expect(h.request.user).toBe(user);
    expect(h.sessionGuard.canActivate).not.toHaveBeenCalled();
  });

  it("rejects a mismatched bearer token without a user lookup", async () => {
    const h = makeContext({ authorization: "Bearer wrong-token" });

    await expect(h.guard.canActivate(h.context)).rejects.toThrow(UnauthorizedException);
    expect(h.users.findByEmail).not.toHaveBeenCalled();
  });

  it("rejects a bearer token when device auth is not configured", async () => {
    vi.stubEnv("SFT_DEVICE_TOKEN", "");
    const h = makeContext({ authorization: `Bearer ${TOKEN}` });

    await expect(h.guard.canActivate(h.context)).rejects.toThrow(
      "device token auth is not configured",
    );
  });

  it("rejects when the configured email resolves to no user", async () => {
    const h = makeContext({ authorization: `Bearer ${TOKEN}` });
    h.users.findByEmail.mockResolvedValue(null);

    await expect(h.guard.canActivate(h.context)).rejects.toThrow("unknown user");
  });

  it("falls back to the session guard when no bearer header is present", async () => {
    const h = makeContext({});
    h.sessionGuard.canActivate.mockResolvedValue(true);

    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
  });

  it("rejects when neither a bearer token nor a session is valid", async () => {
    const h = makeContext({});
    h.sessionGuard.canActivate.mockRejectedValue(new UnauthorizedException());

    await expect(h.guard.canActivate(h.context)).rejects.toThrow(UnauthorizedException);
  });
});

describe("UsageService.insertLlmCalls", () => {
  const base: LlmCallRecord = {
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

  interface LlmCallInsert {
    userId: string;
    runId: string | null;
    provider: string;
    model: string;
    mode: string;
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: string;
    durationMs: number;
  }

  function makeDb(existingRunIds: string[]) {
    const values = vi.fn(async (rows: LlmCallInsert[]) => rows);
    const where = vi.fn(async () => existingRunIds.map((id) => ({ id })));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    const insert = vi.fn(() => ({ values }));
    const db = { select, insert } as unknown as Database;
    return { db, values, select, insert };
  }

  it("maps ledger records onto llm_calls rows and keeps resolvable run links", async () => {
    const knownRun = "33333333-3333-4333-8333-333333333333";
    const { db, values } = makeDb([knownRun]);
    const service = new UsageService(db);

    const result = await service.insertLlmCalls(user, [
      { ...base, runId: knownRun },
      { ...base, mode: "fix" },
    ]);
    expect(result).toEqual({ inserted: 2 });

    expect(values).toHaveBeenCalledTimes(1);
    const rows = values.mock.calls[0][0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      userId: user.id,
      runId: knownRun,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      mode: "explain",
      inputTokens: 100,
      outputTokens: 50,
      totalCostUsd: "0.00105",
      durationMs: 1234,
    });
    expect(rows[1]?.runId).toBeNull();
    expect(rows[1]?.mode).toBe("fix");
  });

  it("stores NULL for an unknown placeholder run instead of failing the batch", async () => {
    const missingRun = "44444444-4444-4444-8444-444444444444";
    const { db, values } = makeDb([]);
    const service = new UsageService(db);

    const result = await service.insertLlmCalls(user, [{ ...base, runId: missingRun }]);
    expect(result).toEqual({ inserted: 1 });
    expect(values.mock.calls[0][0][0]?.runId).toBeNull();
  });

  it("skips the run lookup entirely for a non-uuid runId", async () => {
    const { db, values, select } = makeDb([]);
    const service = new UsageService(db);

    const result = await service.insertLlmCalls(user, [
      { ...base, runId: "not-a-uuid" } satisfies SyncLlmCall,
    ]);
    expect(result).toEqual({ inserted: 1 });
    expect(select).not.toHaveBeenCalled();
    expect(values.mock.calls[0][0][0]?.runId).toBeNull();
  });

  it("does not touch the database for an empty batch", async () => {
    const { db, insert } = makeDb([]);
    const service = new UsageService(db);

    await expect(service.insertLlmCalls(user, [])).resolves.toEqual({ inserted: 0 });
    expect(insert).not.toHaveBeenCalled();
  });
});
