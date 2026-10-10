import type { NextRequest } from "next/server";

/**
 * Dedicated SSE proxy for GET /runs/:id/logs.
 *
 * The generic `/api/*` rewrite in next.config.ts BUFFERS the response, which
 * breaks Server-Sent Events: the live log stream stalls and the terminal
 * never renders chunks. A route handler that returns the upstream body as a
 * ReadableStream streams it through unbuffered, so heartbeat, `chunk` and
 * `end` frames arrive live.
 *
 * next.config.ts excludes `/api/runs/<id>/logs` from the rewrite via a
 * negative-lookahead path pattern, so requests for this path land here
 * instead of the buffering proxy.
 *
 * The session cookie and the `accept` header are forwarded verbatim:
 *  - the API's SessionGuard authenticates off the `sft_session` cookie, which
 *    the browser sends to this same-origin route;
 *  - the API's terminal-run branch keys off `accept: text/event-stream` to
 *    choose between an SSE `end` frame and a 302 to the presigned S3 archive
 *    (which a plain browser navigation to this URL relies on).
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const cookie = request.headers.get("cookie");
  const upstream = await fetch(`${API_URL}/runs/${id}/logs`, {
    method: "GET",
    headers: {
      accept: request.headers.get("accept") ?? "text/event-stream",
      ...(cookie ? { cookie } : {}),
    },
    cache: "no-store",
  });

  // Copy the headers that carry meaning for both branches (live SSE and the
  // 302-to-S3 download), then force the anti-buffering headers the API itself
  // sets. `location` matters: a browser navigation here for a finished run
  // must follow the API's redirect to the archive.
  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "location"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("cache-control", "no-cache, no-transform");
  headers.set("connection", "keep-alive");
  headers.set("x-accel-buffering", "no");

  // Returning the upstream body directly streams it through without Next
  // buffering the whole response first — this is the fix for stalled SSE.
  return new Response(upstream.body, { status: upstream.status, headers });
}
