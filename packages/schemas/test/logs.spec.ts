import { describe, expect, it } from "vitest";
import { LOG_CHUNK_MAX_BYTES, LogEvent, type LogChunk } from "../src/logs";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function chunk(overrides: Partial<LogChunk> = {}): LogChunk {
  return {
    type: "chunk",
    runId: RUN_ID,
    stream: "stdout",
    seq: 0,
    ts: "2026-10-01T12:00:00.000Z",
    data: "[sandbox] install=12ms\n",
    ...overrides,
  };
}

describe("LogEvent (live log streaming envelope)", () => {
  it("accepts a valid chunk", () => {
    expect(LogEvent.safeParse(chunk()).success).toBe(true);
    expect(LogEvent.safeParse(chunk({ stream: "stderr", seq: 7 })).success).toBe(true);
  });

  it("accepts a valid end event", () => {
    const parsed = LogEvent.safeParse({
      type: "end",
      runId: RUN_ID,
      exitCode: 1,
      status: "failed",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a null exit code and a terminal status on end", () => {
    const parsed = LogEvent.safeParse({
      type: "end",
      runId: RUN_ID,
      exitCode: null,
      status: "timeout",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown stream value", () => {
    // Spelled as a literal so this exercises the runtime check: the
    // LogChunk["stream"] type already rejects it at compile time.
    expect(LogEvent.safeParse({ ...chunk(), stream: "stdlog" }).success).toBe(false);
    expect(LogEvent.safeParse(chunk({ stream: "stderr" })).success).toBe(true);
  });

  it("rejects a negative seq", () => {
    expect(LogEvent.safeParse(chunk({ seq: -1 })).success).toBe(false);
    expect(LogEvent.safeParse(chunk({ seq: 1.5 })).success).toBe(false);
  });

  it("rejects a chunk payload over the 64 KiB cap", () => {
    expect(LogEvent.safeParse(chunk({ data: "x".repeat(LOG_CHUNK_MAX_BYTES) })).success).toBe(true);
    expect(LogEvent.safeParse(chunk({ data: "x".repeat(LOG_CHUNK_MAX_BYTES + 1) })).success).toBe(
      false,
    );
  });

  it("rejects an unknown discriminator", () => {
    expect(LogEvent.safeParse({ ...chunk(), type: "progress" }).success).toBe(false);
  });

  it("rejects a run id that is not a uuid", () => {
    expect(LogEvent.safeParse(chunk({ runId: "not-a-uuid" })).success).toBe(false);
  });

  it("rejects a non-ISO timestamp", () => {
    expect(LogEvent.safeParse(chunk({ ts: "yesterday" })).success).toBe(false);
  });
});