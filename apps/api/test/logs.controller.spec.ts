import { NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";
import type { LogEvent } from "@sft/schemas";
import type { Request, Response } from "express";
import { SessionGuard } from "../src/auth/session.guard";
import type { RunRow, UserRow } from "../src/db";
import { LogsController } from "../src/logs/logs.controller";
import type { LogsService } from "../src/logs/logs.service";
import type { RunsService } from "../src/runs/runs.service";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const USER = { id: "33333333-3333-4333-8333-333333333333" } as UserRow;

function runRow(
  status: RunRow["status"],
  exitCode: number | null = null,
  s3LogKey: string | null = null,
): RunRow {
  return {
    id: RUN_ID,
    projectId: "22222222-2222-4222-8222-222222222222",
    sha: null,
    branch: "main",
    trigger: "manual",
    status,
    exitCode,
    failureKind: null,
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    startedAt: new Date("2026-10-01T12:00:01.000Z"),
    finishedAt: status === "running" ? null : new Date("2026-10-01T12:01:00.000Z"),
    buildMinutes: null,
    s3LogKey,
    s3ReportKey: null,
  };
}

/** Minimal Express Response double: the controller only writes frames. */
function responseDouble() {
  const written: string[] = [];
  const headers: Record<string, unknown> = {};
  const listeners = new Map<string, () => void>();
  let statusCode: number | undefined;
  const res = {
    writableEnded: false,
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
      return res;
    },
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    getHeader: (name: string) => headers[name],
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      written.push(chunk);
      return true;
    },
    end: () => {
      res.writableEnded = true;
    },
    on: (event: string, handler: () => void) => {
      listeners.set(event, handler);
      return res;
    },
  };
  return {
    res: res as unknown as Response,
    written,
    headers,
    get statusCode() {
      return statusCode;
    },
    fire: (event: string) => listeners.get(event)?.(),
  };
}

/** Minimal Express Request double: the controller only reads Accept. */
function requestDouble(accept = ""): Request {
  return { headers: { accept } } as unknown as Request;
}

function controller(options: {
  status: RunRow["status"];
  exitCode?: number | null;
  events?: LogEvent[];
  owned?: boolean;
  /** Status returned by the D4 re-check, when it differs. */
  recheckStatus?: RunRow["status"];
  /** Archive prefix on the run; null (default) means no S3 archive. */
  s3LogKey?: string | null;
  /** Value returned by the presigned-URL lookup for archived runs. */
  presignedUrl?: string | null;
}) {
  const queue: RunRow["status"][] = options.recheckStatus
    ? [options.status, options.recheckStatus]
    : [options.status, options.status];
  const runsService = {
    getOwnedRun: vi.fn(async () => {
      if (options.owned === false) throw new NotFoundException("run not found");
      const status = queue.shift() ?? options.status;
      return runRow(status, options.exitCode ?? null, options.s3LogKey ?? null);
    }),
  };
  const logsService = {
    // Async, like the real service: with no events this parks until aborted,
    // which is exactly what the disconnect test needs.
    subscribe: vi.fn(async function* () {
      for (const event of options.events ?? []) yield event;
    }),
    getPresignedLogUrl: vi.fn(async () => options.presignedUrl ?? null),
  };
  return {
    controller: new LogsController(
      runsService as unknown as RunsService,
      logsService as unknown as LogsService,
    ),
    logsService,
  };
}

describe("LogsController (M2b-1)", () => {
  // Nest DI cannot construct SessionGuard from decorator metadata in this
  // transform (its deps are imported as types), so the endpoint is exercised
  // directly and guard wiring is asserted through the metadata Nest reads.
  it("is protected by SessionGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, LogsController) as unknown[];
    expect(guards).toContain(SessionGuard);
  });

  it("404s for a run the user does not own", async () => {
    const { controller: ctl } = controller({ status: "running", owned: false });
    const { res } = responseDouble();
    await expect(
      ctl.streamLogs(USER, RUN_ID, requestDouble(), res),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("emits one end frame and closes for a terminal run", async () => {
    const { controller: ctl, logsService } = controller({ status: "failed", exitCode: 1 });
    const { res, written, headers } = responseDouble();

    await ctl.streamLogs(USER, RUN_ID, requestDouble(), res);

    expect(headers["Content-Type"]).toBe("text/event-stream");
    expect(headers["Cache-Control"]).toBe("no-cache, no-transform");
    expect(headers["Connection"]).toBe("keep-alive");
    expect(headers["X-Accel-Buffering"]).toBe("no");
    expect(written).toEqual([
      `data: ${JSON.stringify({ type: "end", runId: RUN_ID, exitCode: 1, status: "failed" })}\n\n`,
    ]);
    expect(res.writableEnded).toBe(true);
    // A finished run must never open a Redis subscription.
    expect(logsService.subscribe).not.toHaveBeenCalled();
  });

  it("streams chunk frames in order and closes on the end event", async () => {
    const events: LogEvent[] = [
      {
        type: "chunk",
        runId: RUN_ID,
        stream: "stdout",
        seq: 1,
        ts: "2026-10-01T12:00:00.000Z",
        data: "installing",
      },
      { type: "end", runId: RUN_ID, exitCode: 1, status: "failed" },
    ];
    const { controller: ctl } = controller({ status: "running", events });
    const { res, written } = responseDouble();

    await ctl.streamLogs(USER, RUN_ID, requestDouble(), res);

    expect(written).toEqual([
      `data: ${JSON.stringify(events[0])}\n\n`,
      `data: ${JSON.stringify(events[1])}\n\n`,
    ]);
    expect(res.writableEnded).toBe(true);
  });

  it("closes immediately when the run finished between lookup and subscribe", async () => {
    // D4 race: the first lookup says running, the re-check says runner_crash.
    const { controller: ctl, logsService } = controller({
      status: "running",
      exitCode: 2,
      recheckStatus: "runner_crash",
    });
    const { res, written } = responseDouble();

    await ctl.streamLogs(USER, RUN_ID, requestDouble(), res);

    expect(written.join("")).toContain('"type":"end"');
    expect(written.join("")).toContain('"status":"runner_crash"');
    expect(logsService.subscribe).not.toHaveBeenCalled();
    expect(res.writableEnded).toBe(true);
  });

  it("tears down when the client disconnects mid-stream", async () => {
    const { controller: ctl } = controller({ status: "running", events: [] });
    const { res, fire } = responseDouble();

    // The generator parks forever; only the disconnect can end this call.
    const pending = ctl.streamLogs(USER, RUN_ID, requestDouble(), res);
    await new Promise((resolve) => setImmediate(resolve));
    fire("close");

    await expect(pending).resolves.toBeUndefined();
    expect(res.writableEnded).toBe(true);
  });

  describe("terminal run with S3 archive", () => {
    it("302 redirects when Accept is text/html and s3LogKey is set", async () => {
      const { controller: ctl } = controller({
        status: "success",
        s3LogKey: "logs/abc",
        presignedUrl: "https://signed.example/combined.log",
      });
      const double = responseDouble();

      await ctl.streamLogs(USER, RUN_ID, requestDouble("text/html"), double.res);

      expect(double.statusCode).toBe(302);
      expect(double.headers["Location"]).toBe(
        "https://signed.example/combined.log",
      );
    });

    it("SSE path when Accept is text/event-stream (regression guard)", async () => {
      const { controller: ctl, logsService } = controller({
        status: "success",
        s3LogKey: "logs/abc",
        presignedUrl: "https://signed.example/combined.log",
      });
      const double = responseDouble();

      await ctl.streamLogs(
        USER,
        RUN_ID,
        requestDouble("text/event-stream"),
        double.res,
      );

      expect(double.statusCode).toBeUndefined();
      expect(double.headers["Content-Type"]).toBe("text/event-stream");
      expect(double.written.join("")).toContain('"type":"end"');
      expect(logsService.getPresignedLogUrl).not.toHaveBeenCalled();
      expect(double.res.writableEnded).toBe(true);
    });

    it("SSE path when s3LogKey is null", async () => {
      const { controller: ctl, logsService } = controller({
        status: "success",
        presignedUrl: "https://signed.example/combined.log",
      });
      const double = responseDouble();

      await ctl.streamLogs(USER, RUN_ID, requestDouble("text/html"), double.res);

      expect(double.statusCode).toBeUndefined();
      expect(double.headers["Content-Type"]).toBe("text/event-stream");
      expect(logsService.getPresignedLogUrl).not.toHaveBeenCalled();
    });

    it("SSE path for a running run", async () => {
      const { controller: ctl, logsService } = controller({
        status: "running",
        s3LogKey: "logs/abc",
        presignedUrl: "https://signed.example/combined.log",
        events: [{ type: "end", runId: RUN_ID, exitCode: 0, status: "success" }],
      });
      const double = responseDouble();

      await ctl.streamLogs(USER, RUN_ID, requestDouble("text/html"), double.res);

      expect(double.statusCode).toBeUndefined();
      expect(double.headers["Content-Type"]).toBe("text/event-stream");
      expect(logsService.subscribe).toHaveBeenCalled();
      expect(logsService.getPresignedLogUrl).not.toHaveBeenCalled();
    });
  });
});