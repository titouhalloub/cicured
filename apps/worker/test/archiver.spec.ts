import type { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import {
  ARCHIVER_KEEP_BYTES,
  ARCHIVER_TRUNCATE_THRESHOLD,
  createLogArchiver,
} from "../src/logs/archiver";
import { createLogger } from "../src/common/secrets";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const logger = createLogger("archiver-test");

interface SentCommand {
  Bucket?: string;
  Key?: string;
  Body?: Buffer;
  ContentType?: string;
}

/** S3 double: records PutObject inputs, returns canned success. */
function s3Double(options: { fail?: boolean } = {}) {
  const sent: SentCommand[] = [];
  const send = vi.fn(async (command: unknown) => {
    if (options.fail) throw new Error("S3 is down");
    const input = (command as InstanceType<typeof PutObjectCommand>).input as SentCommand;
    sent.push(input);
    return {};
  });
  const client = { send } as unknown as S3Client;
  return { client, sent, send };
}

function archiverFor(client: S3Client) {
  return createLogArchiver({ s3Client: client, bucket: "test-logs", runId: RUN_ID, logger });
}

function bodyOf(sent: SentCommand[], key: string): Buffer | undefined {
  const found = sent.find((command) => command.Key === key);
  const body = found?.Body;
  if (!body) return undefined;
  return Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array);
}

describe("createLogArchiver (M2b-2)", () => {
  it("uploads one PutObject per non-empty stream at the correct key with the expected body", async () => {
    const { client, sent } = s3Double();
    const archiver = archiverFor(client);
    archiver.append("stdout", Buffer.from("hello out\n"), 1);
    archiver.append("stderr", Buffer.from("hello err\n"), 2);

    const result = await archiver.flush();

    expect(result).toEqual({ s3Key: `logs/${RUN_ID}`, stdoutBytes: 10, stderrBytes: 10 });
    const keys = sent.map((command) => command.Key).sort();
    expect(keys).toEqual([
      `logs/${RUN_ID}/combined.log`,
      `logs/${RUN_ID}/stderr.log`,
      `logs/${RUN_ID}/stdout.log`,
    ]);
    expect(bodyOf(sent, `logs/${RUN_ID}/stdout.log`)?.toString("utf8")).toBe("hello out\n");
    expect(bodyOf(sent, `logs/${RUN_ID}/stderr.log`)?.toString("utf8")).toBe("hello err\n");
    for (const command of sent) {
      expect(command.Bucket).toBe("test-logs");
      expect(command.ContentType).toBe("text/plain; charset=utf-8");
    }
  });

  it("emits no PutObject for empty streams", async () => {
    const { client, sent } = s3Double();
    const archiver = archiverFor(client);
    archiver.append("stdout", Buffer.from("only stdout"), 1);

    const result = await archiver.flush();

    expect(result.stdoutBytes).toBe(11);
    expect(result.stderrBytes).toBe(0);
    expect(sent.map((command) => command.Key).sort()).toEqual([
      `logs/${RUN_ID}/combined.log`,
      `logs/${RUN_ID}/stdout.log`,
    ]);
  });

  it("emits nothing when no chunks were appended", async () => {
    const { client, sent } = s3Double();
    const archiver = archiverFor(client);

    const result = await archiver.flush();

    expect(result).toEqual({ s3Key: `logs/${RUN_ID}`, stdoutBytes: 0, stderrBytes: 0 });
    expect(sent).toHaveLength(0);
  });

  it("orders combined.log by seq across both streams", async () => {
    const { client, sent } = s3Double();
    const archiver = archiverFor(client);
    archiver.append("stderr", Buffer.from("err-first\n"), 1);
    archiver.append("stdout", Buffer.from("out-second\n"), 2);
    archiver.append("stderr", Buffer.from("err-third\n"), 3);

    await archiver.flush();

    expect(bodyOf(sent, `logs/${RUN_ID}/combined.log`)?.toString("utf8")).toBe(
      "err-first\nout-second\nerr-third\n",
    );
  });

  it("falls back to arrival order when seq is missing", async () => {
    const { client, sent } = s3Double();
    const archiver = archiverFor(client);
    archiver.append("stdout", Buffer.from("b"));
    archiver.append("stderr", Buffer.from("a"));

    await archiver.flush();

    expect(bodyOf(sent, `logs/${RUN_ID}/combined.log`)?.toString("utf8")).toBe("ba");
  });

  it("truncates streams past 10 MB with a marker and reports post-truncation bytes", async () => {
    const { client, sent } = s3Double();
    const archiver = archiverFor(client);
    // Two chunks: together they exceed the threshold, so head+tail are kept.
    const over = ARCHIVER_TRUNCATE_THRESHOLD + 1024;
    archiver.append("stdout", Buffer.alloc(over, "x"), 1);

    const result = await archiver.flush();

    const stdout = bodyOf(sent, `logs/${RUN_ID}/stdout.log`)?.toString("utf8") ?? "";
    expect(stdout).toContain("[sft-dev] stdout truncated: dropped");
    expect(stdout.startsWith("x".repeat(100))).toBe(true);
    expect(stdout.endsWith("x".repeat(100))).toBe(true);
    // Post-truncation size: 5 MB head + marker + 5 MB tail.
    expect(result.stdoutBytes).toBeGreaterThan(2 * ARCHIVER_KEEP_BYTES);
    expect(result.stdoutBytes).toBeLessThan(over);
    expect(result.s3Key).toBe(`logs/${RUN_ID}`);
  });

  it("is idempotent: a second flush uploads nothing", async () => {
    const { client, sent, send } = s3Double();
    const archiver = archiverFor(client);
    archiver.append("stdout", Buffer.from("once"), 1);

    const first = await archiver.flush();
    const second = await archiver.flush();

    expect(second).toEqual(first);
    expect(send).toHaveBeenCalledTimes(2); // stdout.log + combined.log, once
    expect(sent).toHaveLength(2);
    // Appends after flush are ignored.
    archiver.append("stdout", Buffer.from("late"), 2);
    await archiver.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("returns a null key without throwing when S3 fails", async () => {
    const { client, sent } = s3Double({ fail: true });
    const archiver = archiverFor(client);
    archiver.append("stdout", Buffer.from("lost"), 1);

    const result = await archiver.flush();

    expect(result).toEqual({ s3Key: null, stdoutBytes: 0, stderrBytes: 0 });
    expect(sent).toHaveLength(0);
  });
});