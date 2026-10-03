import { describe, expect, it, vi } from "vitest";
import type IORedis from "ioredis";
import { createLogPublisher, logChannelFor } from "../src/logs/publisher";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function redisDouble() {
  const publish = vi.fn(async (_channel: string, _message: string) => 1);
  return { redis: { publish } as unknown as IORedis, publish };
}

describe("createLogPublisher", () => {
  it("publishes to the prefixed per-run channel", async () => {
    const { redis, publish } = redisDouble();
    const publisher = createLogPublisher(redis, "sft:logs:");

    await publisher.publish(RUN_ID, {
      type: "chunk",
      runId: RUN_ID,
      stream: "stdout",
      seq: 1,
      ts: "2026-10-01T12:00:00.000Z",
      data: "hello",
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = publish.mock.calls[0]!;
    expect(channel).toBe(`sft:logs:${RUN_ID}`);
    expect(JSON.parse(payload as string)).toMatchObject({
      type: "chunk",
      runId: RUN_ID,
      data: "hello",
    });
  });

  it("respects a custom channel prefix", async () => {
    const { redis, publish } = redisDouble();
    await createLogPublisher(redis, "custom:stream:").publish(RUN_ID, {
      type: "end",
      runId: RUN_ID,
      exitCode: 0,
      status: "success",
    });
    expect(publish.mock.calls[0]![0]).toBe(`custom:stream:${RUN_ID}`);
  });

  it("publishes the end event", async () => {
    const { redis, publish } = redisDouble();
    await createLogPublisher(redis, "sft:logs:").publish(RUN_ID, {
      type: "end",
      runId: RUN_ID,
      exitCode: 1,
      status: "failed",
    });
    expect(JSON.parse(publish.mock.calls[0]![1] as string)).toEqual({
      type: "end",
      runId: RUN_ID,
      exitCode: 1,
      status: "failed",
    });
  });

  it("close() does not quit the client it borrows", async () => {
    const quit = vi.fn(async () => "OK");
    const { redis, publish } = redisDouble();
    const borrowed = { ...redis, quit } as unknown as IORedis;

    await createLogPublisher(borrowed, "sft:logs:").close();

    expect(quit).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("builds channel names from prefix and run id", () => {
    expect(logChannelFor("sft:logs:", RUN_ID)).toBe(`sft:logs:${RUN_ID}`);
  });
});