import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { isTerminalRunStatus, type LogEnd } from "@sft/schemas";
import type { Request, Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionGuard } from "../auth/session.guard";
import type { UserRow } from "../db";
import { RunsService } from "../runs/runs.service";
import { LogsService } from "./logs.service";

/** Proxies keep idle SSE connections warm; 30 s is well under common timeouts. */
const HEARTBEAT_MS = 30_000;
/** Hard cap on a single SSE connection, per the M2b-1 contract. */
const MAX_CONNECTION_MS = 30 * 60_000;

@Controller()
@UseGuards(SessionGuard)
export class LogsController {
  constructor(
    private readonly runsService: RunsService,
    private readonly logsService: LogsService,
  ) {}

  /**
   * GET /runs/:id/logs - live SSE stream (Spec §6).
   *
   * Frames are written manually rather than via `@Sse()` so teardown is
   * explicit: a disconnect, the run ending, the 30 s heartbeat and the 30 min
   * cap all have to converge on one idempotent close.
   */
  @Get("runs/:id/logs")
  async streamLogs(
    @CurrentUser() user: UserRow,
    @Param("id") runId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Ownership check first: a foreign or unknown run is a 404, never a stream.
    let run;
    try {
      run = await this.runsService.getOwnedRun(user, runId);
    } catch {
      throw new NotFoundException("run not found");
    }

    if (isTerminalRunStatus(run.status)) {
      // M2b-2b: a non-SSE client asking for a finished run with an S3 archive
      // gets a presigned download of combined.log instead of an empty frame.
      const accept = String(req.headers.accept ?? "");
      const wantsSse = /text\/event-stream/i.test(accept);
      if (!wantsSse && run.s3LogKey) {
        const url = await this.logsService.getPresignedLogUrl(user, runId);
        if (url) {
          res.status(302).setHeader("Location", url).end();
          return;
        }
      }
      // Live-only: a finished run replays nothing, so the client is told the
      // run is over immediately.
      writeSseHeaders(res);
      writeFrame(res, {
        type: "end",
        runId,
        exitCode: run.exitCode,
        status: run.status,
      } satisfies LogEnd);
      res.end();
      return;
    }

    writeSseHeaders(res);

    // D4: the run can finish between the lookup above and the subscription.
    // Re-check before subscribing so a run that ended in that window closes
    // immediately instead of parking a client until the 30-minute cap.
    const current = await this.runsService.getOwnedRun(user, runId);
    if (isTerminalRunStatus(current.status)) {
      writeFrame(res, {
        type: "end",
        runId,
        exitCode: current.exitCode,
        status: current.status,
      } satisfies LogEnd);
      res.end();
      return;
    }

    const abort = new AbortController();
    const iterator = this.logsService.subscribe(runId, abort.signal)[Symbol.asyncIterator]();
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, HEARTBEAT_MS);
    const cap = setTimeout(() => close(), MAX_CONNECTION_MS);
    let closed = false;

    function close(): void {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(cap);
      // Abort first: that is what actually unblocks an idle generator so its
      // `finally` can release the shared Redis subscription.
      abort.abort();
      void iterator.return?.();
      if (!res.writableEnded) res.end();
    }

    res.on("close", close);

    try {
      for (;;) {
        const next = await iterator.next();
        if (next.done || closed) break;
        const event = next.value;
        writeFrame(res, event);
        if (event.type === "end") break;
      }
    } catch {
      // A broken stream is a closed stream; the run itself is unaffected.
    } finally {
      close();
    }
  }
}

/**
 * `X-Accel-Buffering: no` disables nginx proxy buffering, which otherwise
 * breaks SSE entirely behind a reverse proxy.
 */
function writeSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function writeFrame(res: Response, event: unknown): void {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}