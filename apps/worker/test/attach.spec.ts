import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { LogChunk } from "@sft/schemas";
import { createLogger } from "../src/common/secrets";
import { attachAndStream, createFrameDemuxer } from "../src/logs/attach";
import type { LogPublisher } from "../src/logs/publisher";
import type { DockerLike } from "../src/sandbox/launcher";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

/** Builds one Docker frame: [type(1)][0,0,0][size(4 BE)][payload]. */
function frame(streamType: number, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = streamType;
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function publisherDouble() {
  const chunks: LogChunk[] = [];
  const publish = vi.fn(async (_runId: string, event: LogChunk) => {
    if (event.type === "chunk") chunks.push(event);
  });
  return {
    chunks,
    publish,
    publisher: { publish, close: async () => undefined } as unknown as LogPublisher,
  };
}

function dockerServing(stream: Readable): DockerLike {
  return {
    createContainer: async () => {
      throw new Error("not used");
    },
    getContainer: () =>
      ({
        logs: async () => stream as unknown as NodeJS.ReadableStream,
      }) as unknown as ReturnType<DockerLike["getContainer"]>,
  };
}

describe("createFrameDemuxer", () => {
  it("splits multiplexed frames into labelled streams", () => {
    const seen: Array<[string, string]> = [];
    const demuxer = createFrameDemuxer({
      onFrame: (stream, payload) => seen.push([stream, payload.toString("utf8")]),
      onUnknownStream: () => undefined,
    });

    demuxer.write(Buffer.concat([frame(1, "out-a"), frame(2, "err-a"), frame(1, "out-b")]));

    expect(seen).toEqual([
      ["stdout", "out-a"],
      ["stderr", "err-a"],
      ["stdout", "out-b"],
    ]);
  });

  it("reassembles frames split across chunk boundaries", () => {
    const seen: Array<[string, string]> = [];
    const demuxer = createFrameDemuxer({
      onFrame: (stream, payload) => seen.push([stream, payload.toString("utf8")]),
      onUnknownStream: () => undefined,
    });

    const whole = frame(1, "hello world");
    demuxer.write(whole.subarray(0, 5)); // partial header
    expect(seen).toHaveLength(0);
    demuxer.write(whole.subarray(5, 12)); // partial payload
    expect(seen).toHaveLength(0);
    demuxer.write(whole.subarray(12));
    expect(seen).toEqual([["stdout", "hello world"]]);
  });

  it("drops unknown stream types without throwing", () => {
    const unknown: number[] = [];
    const seen: Array<[string, string]> = [];
    const demuxer = createFrameDemuxer({
      onFrame: (stream, payload) => seen.push([stream, payload.toString("utf8")]),
      onUnknownStream: (type) => unknown.push(type),
    });

    expect(() => demuxer.write(Buffer.concat([frame(9, "junk"), frame(1, "ok")]))).not.toThrow();
    expect(unknown).toEqual([9]);
    expect(seen).toEqual([["stdout", "ok"]]);
  });
});

describe("attachAndStream", () => {
  it("publishes labelled chunks with a monotonic seq across both streams", async () => {
    const { publisher, chunks } = publisherDouble();
    const source = Readable.from([
      frame(1, "installing..."),
      frame(2, "pnpm: warn deprecated"),
      frame(1, "done"),
    ]);

    const handle = await attachAndStream(
      dockerServing(source),
      "container-1",
      RUN_ID,
      publisher,
      createLogger("attach-test"),
    );
    await handle.stop();

    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.stream)).toEqual(["stdout", "stderr", "stdout"]);
    expect(chunks.map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(chunks.map((c) => c.data)).toEqual([
      "installing...",
      "pnpm: warn deprecated",
      "done",
    ]);
    expect(chunks.every((c) => c.runId === RUN_ID)).toBe(true);
    expect(chunks.every((c) => !Number.isNaN(Date.parse(c.ts)))).toBe(true);
  });

  it("warns once for unknown stream types and keeps streaming", async () => {
    const { publisher, chunks } = publisherDouble();
    const source = Readable.from([frame(7, "junk"), frame(7, "junk"), frame(1, "ok")]);
    const warnings: string[] = [];
    const logger = {
      info: () => undefined,
      warn: (message: string) => warnings.push(message),
      error: () => undefined,
      child: () => logger,
    };

    const handle = await attachAndStream(
      dockerServing(source),
      "container-1",
      RUN_ID,
      publisher,
      logger,
    );
    await handle.stop();

    expect(warnings.filter((w) => w.includes("unknown stream_type"))).toHaveLength(1);
    expect(chunks.map((c) => c.data)).toEqual(["ok"]);
  });

  it("stop() is idempotent", async () => {
    const { publisher } = publisherDouble();
    const source = Readable.from([frame(1, "hi")]);
    const handle = await attachAndStream(
      dockerServing(source),
      "container-1",
      RUN_ID,
      publisher,
      createLogger("attach-test"),
    );

    await expect(Promise.all([handle.stop(), handle.stop()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });
});