"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LogEvent, type SessionUser } from "@sft/schemas";
import { API_BASE, apiFetch } from "./api";
import type { FindingWithId, ProjectSummary, RunSummary, SuggestionWithId } from "./schemas";

/** Shape of GET /projects/:id/runs (Spec §6). */
export interface RunsPage {
  items: RunSummary[];
  total: number;
  limit: number;
  offset: number;
}

export function fetchProjects(): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>("/projects");
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
}

/**
 * GET /auth/me — the signed-in user. Long staleTime: the session only changes
 * on login/logout, so there is no reason to re-validate it constantly.
 */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<SessionUser>("/auth/me"),
    staleTime: 5 * 60_000,
  });
}

/**
 * All runs across every project, newest first.
 *
 * TODO(M5): add GET /runs?limit=50 to API — there is no aggregate runs
 * endpoint today, so this fans out to GET /projects/:id/runs per project
 * (a known N+1; bounded by the user's project count).
 */
export async function fetchAllRuns(): Promise<{
  projects: ProjectSummary[];
  runs: RunSummary[];
}> {
  const projects = await fetchProjects();
  const pages = await Promise.all(
    projects.map((project) => apiFetch<RunsPage>(`/projects/${project.id}/runs?limit=50`)),
  );
  const runs = pages.flatMap((page) => page.items);
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { projects, runs };
}

export function useAllRuns() {
  return useQuery({ queryKey: ["runs"], queryFn: fetchAllRuns });
}

// ─── Run detail (M4b-2a) ────────────────────────────────────────────────────

/** GET /runs/:id — a single run's summary. */
export function useRun(id: string) {
  return useQuery({
    queryKey: ["run", id],
    queryFn: () => apiFetch<RunSummary>(`/runs/${id}`),
    staleTime: 30_000,
  });
}

/**
 * GET /runs/:id/findings — the parser's findings for a run. Gated on the run
 * being terminal: the worker writes findings after the sandbox exits, so
 * polling a running run would just return an empty list.
 */
export function useFindings(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["findings", runId],
    queryFn: () => apiFetch<FindingWithId[]>(`/runs/${runId}/findings`),
    enabled,
    staleTime: 30_000,
  });
}

/** GET /runs/:id/suggestions — LLM drafts for a run (same terminal gate). */
export function useSuggestions(runId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["suggestions", runId],
    queryFn: () => apiFetch<SuggestionWithId[]>(`/runs/${runId}/suggestions`),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * POST /suggestions/:id/feedback — accept or reject a suggestion (Spec §4
 * step 11). Records the verdict only; it never applies the patch.
 */
export function useSuggestionFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accepted }: { id: string; accepted: boolean }) =>
      apiFetch<{ ok: true }>(`/suggestions/${id}/feedback`, {
        method: "POST",
        body: JSON.stringify({ accepted }),
      }),
    onSuccess: () => {
      // Invalidate every suggestions query. Cheap and correct — the
      // alternative is tracking which run owns the suggestion, but the
      // caller already knows.
      qc.invalidateQueries({ queryKey: ["suggestions"] });
    },
  });
}

/**
 * Live log stream for a run, read over `fetch` + `ReadableStream`.
 *
 * EventSource is deliberately NOT used: it cannot send cookies cross-origin,
 * and the Codespace-forwarded-URL flow depends on the httpOnly session cookie
 * travelling with the request. `fetch` with `credentials: "include"` does.
 *
 * Known limitations:
 *  - No automatic reconnect; if the stream drops mid-run, `done` stays false
 *    and the caller must reload. TODO(M4.1): exponential backoff.
 *  - Frames split across TCP chunks are handled by the buffer loop; frames
 *    carrying keepalive comments are skipped by the `:` check. Good enough for
 *    our server's exact SSE framing.
 */
export function useRunLogs(runId: string, enabled: boolean) {
  const [chunks, setChunks] = useState<LogEvent[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    setChunks([]);
    setDone(false);
    setError(null);

    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/runs/${runId}/logs`, {
          credentials: "include",
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          if (!cancelled) setError(`stream failed: ${res.status}`);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done: readerDone, value } = await reader.read();
          if (readerDone) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by \n\n
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (frame.startsWith(":")) continue; // keepalive comment
            if (!frame.startsWith("data: ")) continue;

            const json = frame.slice(6);
            let parsed: unknown;
            try {
              parsed = JSON.parse(json);
            } catch {
              continue; // ignore malformed frames
            }
            const result = LogEvent.safeParse(parsed);
            if (!result.success) continue;
            if (cancelled) return;
            setChunks((prev) => [...prev, result.data]);
            if (result.data.type === "end") {
              setDone(true);
              controller.abort();
              return;
            }
          }
        }
      } catch (e: unknown) {
        if (cancelled) return;
        if (e instanceof Error && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "stream error");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runId, enabled]);

  return { chunks, done, error };
}
