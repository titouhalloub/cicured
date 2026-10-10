"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/api";
import { useRunLogs } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Live log pane for a run.
 *
 * While the run is active the stream is read over `fetch` (see `useRunLogs` —
 * EventSource cannot carry the session cookie cross-origin). Once the run is
 * terminal the SSE endpoint 302s to the presigned S3 archive, so the pane
 * offers a download link instead of a dead stream.
 */
export function LiveLogViewer({ runId, enabled }: { runId: string; enabled: boolean }) {
  const { chunks, done, error } = useRunLogs(runId, enabled);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom unless the reader has scrolled up to inspect history.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [chunks]);

  if (!enabled) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
          Live logs are unavailable for completed runs.
        </p>
        <div>
          <Button variant="outline" size="sm" asChild>
            <a
              href={`${API_BASE}/runs/${runId}/logs`}
              title={`Download archived logs for run ${runId}`}
            >
              <ExternalLink />
              Download archived logs
            </a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={containerRef}
        className="max-h-[500px] overflow-y-auto rounded-card bg-[#0B1437] p-4 font-mono text-xs leading-relaxed text-[#A3AED0]"
      >
        {chunks.map((event) =>
          event.type === "chunk" ? (
            <span
              key={`${event.stream}-${event.seq}`}
              className={cn(
                "whitespace-pre-wrap",
                event.stream === "stderr" && "text-red-300",
              )}
            >
              {event.data}
            </span>
          ) : null,
        )}
      </div>

      {done ? (
        <p className="flex items-center gap-1.5 text-xs text-text-muted-light dark:text-text-muted-dark">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Stream ended
        </p>
      ) : null}

      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-brand-warning">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
