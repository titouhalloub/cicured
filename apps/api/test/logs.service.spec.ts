import { describe, expect, it, vi } from "vitest";
import type { LogEvent } from "@sft/schemas";
import { LogsService } from "../src/logs/logs.service";
import { makeConfig } from "./test-utils";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function chunk(seq: number): LogEvent {
  return {
    type: "chunk",
    runId: RUN_ID,
    stream: "stdout",
    seq,
    ts: "2026-10-01T12:00:00.000Z",
    data: `line ${seq}`,
  };
}

/** Stands in for the ioredis subscriber connection. */
function redisDouble() {
  return {
    subscribe: vi.fn(async () => 1),
    unsubscribe: vi.fn(async () => 0),
    quit: vi.fn(async () => "OK"),
    disconnect: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function makeService(redis: ReturnType<typeof redisDouble>) {
  const service = new LogsService(makeConfig());
  // Test seam: the service builds its own client lazily, so we hand it a
  // double instead of connecting to Redis.
  (service as unknown as { client: unknown }).client = redis;
  return service;
}

/** Pushes a raw payload as if Redis delivered it. */
function deliver(redis: ReturnType<typeof redisDouble>, channel: string, payload: unknown): void {
  const handlers = redis.on.mock.calls
    .filter((call) => call[0] === "message")
    .map((call) => call[1] as (c: string, m: string) => void);
  const handler = handlers.at(-1);
  if (!handler) throw new Error("no message handler registered");
  handler(channel, typeof payload === "string" ? payload : JSON.stringify(payload));
}

/**
 * Lets the generator's `acquire()` microtasks run. Calling `.next()` on an
 * async generator does not execute its body, and `subscribe()` awaits the
 * SUBSCRIBE before registering the listener, so assertions about refcounts and
 * handlers have to wait a tick.
 */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Subscribes with an abort handle so the test can always release the room. */
function subscribeWithAbort(service: LogsService, runId: string) {
  const abort = new AbortController();
  const iterator = service.subscribe(runId, abort.signal);
  return {
    iterator,
    abort,
    /** Abort, then wait for the parked generator to actually finish. */
    async close(pending?: Promise<IteratorResult<LogEvent>>) {
      abort.abort();
      if (pending) await pending;
      await iterator.return?.();
    },
  };
}

describe("LogsService", () => {
  it("subscribes to the prefixed per-run channel", async () => {
    const redis = redisDouble();
    const service = makeService(redis);

    const session = subscribeWithAbort(service, RUN_ID);
    const pending = session.iterator.next();
    await tick();

    expect(redis.subscribe).toHaveBeenCalledWith(`sft:logs:${RUN_ID}`);
    await session.close(pending);
  });

  it("honours a custom channel prefix", async () => {
    const redis = redisDouble();
    const service = new LogsService(makeConfig({ SFT_LOG_CHANNEL_PREFIX: "custom:" }));
    (service as unknown as { client: unknown }).client = redis;

    const session = subscribeWithAbort(service, RUN_ID);
    const pending = session.iterator.next();
    expect(redis.subscribe).toHaveBeenCalledWith(`custom:${RUN_ID}`);
    await session.close(pending);
  });

  it("shares one Redis subscription across concurrent clients", async () => {
    const redis = redisDouble();
    const service = makeService(redis);

    const a = subscribeWithAbort(service, RUN_ID);
    const b = subscribeWithAbort(service, RUN_ID);
    const nextA = a.iterator.next();
    const nextB = b.iterator.next();
    await tick();

    expect(redis.subscribe).toHaveBeenCalledTimes(1);
    expect(service.refCount(RUN_ID)).toBe(2);

    deliver(redis, `sft:logs:${RUN_ID}`, chunk(1));
    expect((await nextA).value).toEqual(chunk(1));
    expect((await nextB).value).toEqual(chunk(1));

    await a.close();
    await b.close();
  });

  it("unsubscribes only when the last client leaves", async () => {
    const redis = redisDouble();
    const service = makeService(redis);

    const a = subscribeWithAbort(service, RUN_ID);
    const b = subscribeWithAbort(service, RUN_ID);
    const nextA = a.iterator.next();
    const nextB = b.iterator.next();

    await a.close(nextA);
    expect(redis.unsubscribe).not.toHaveBeenCalled();
    expect(service.refCount(RUN_ID)).toBe(1);

    await b.close(nextB);
    expect(redis.unsubscribe).toHaveBeenCalledWith(`sft:logs:${RUN_ID}`);
    expect(service.refCount(RUN_ID)).toBe(0);
  });

  it("yields validated events and ends the stream on an end event", async () => {
    const redis = redisDouble();
    const service = makeService(redis);
    const session = subscribeWithAbort(service, RUN_ID);
    const iterator = session.iterator;
    const next = iterator.next();
    await tick();

    deliver(redis, `sft:logs:${RUN_ID}`, chunk(1));
    expect((await next).value).toMatchObject({ type: "chunk", seq: 1 });

    deliver(redis, `sft:logs:${RUN_ID}`, {
      type: "end",
      runId: RUN_ID,
      exitCode: 1,
      status: "failed",
    });
    const second = await iterator.next();
    expect(second.value).toMatchObject({ type: "end", status: "failed" });

    // The generator completes on the terminal event.
    expect((await iterator.next()).done).toBe(true);
    expect(service.refCount(RUN_ID)).toBe(0);
  });

  it("drops payloads that fail LogEvent validation", async () => {
    const redis = redisDouble();
    const service = makeService(redis);
    const session = subscribeWithAbort(service, RUN_ID);
    const next = session.iterator.next();
    await tick();

    deliver(redis, `sft:logs:${RUN_ID}`, { type: "chunk", data: "no runId" });
    deliver(redis, `sft:logs:${RUN_ID}`, "not json at all");
    deliver(redis, `sft:logs:${RUN_ID}`, chunk(7));

    expect((await next).value).toEqual(chunk(7));
    await session.close();
  });
});