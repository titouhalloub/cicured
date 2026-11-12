"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { isTerminalRunStatus } from "@sft/schemas";
import { Square } from "lucide-react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/relative-time";
import { formatDuration, shortSha } from "@/lib/format";
import type { ProjectSummary, RunSummary } from "@/lib/schemas";
import { StatusBadge } from "./status-badge";
import { apiFetch } from "@/lib/api";

interface RunsTableProps {
  runs: RunSummary[];
  projects: ProjectSummary[];
}

/** Reusable runs table: row click navigates to /app/runs/[id]; commit opens GitHub. */
export function RunsTable({ runs, projects }: RunsTableProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function cancelRun(runId: string) {
    setCancellingId(runId);
    try {
      const result = await apiFetch<{ cancelled: boolean }>(`/runs/${runId}/cancel`, {
        method: "POST",
      });
      toast.success(result.cancelled ? "Run cancelled" : "Run already finished");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["runs"] }),
        queryClient.invalidateQueries({ queryKey: ["run", runId] }),
      ]);
    } catch {
      toast.error("Could not cancel run");
    } finally {
      setCancellingId(null);
    }
  }

  const projectNameById = new Map(projects.map((project) => [project.id, project.repoFullName]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-black/5 text-text-muted-light dark:border-white/10 dark:text-text-muted-dark">
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Project</th>
            <th className="px-4 py-3 font-medium">Branch</th>
            <th className="px-4 py-3 font-medium">Commit</th>
            <th className="px-4 py-3 font-medium">Trigger</th>
            <th className="px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const repoName = projectNameById.get(run.projectId);
            return (
              <tr
                key={run.id}
                onClick={() => router.push(`/app/runs/${run.id}`)}
                className="cursor-pointer border-b border-black/5 transition-colors last:border-0 hover:bg-surface-light dark:border-white/10 dark:hover:bg-white/5"
              >
                <td className="px-4 py-3">
                  <StatusBadge status={run.status} />
                </td>
                <td className="px-4 py-3">{repoName ?? "unknown project"}</td>
                <td className="px-4 py-3 font-mono text-xs">{run.branch}</td>
                <td className="px-4 py-3">
                  {run.sha && repoName ? (
                    <a
                      href={`https://github.com/${repoName}/commit/${run.sha}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="font-mono text-xs text-brand-primary hover:underline"
                    >
                      {shortSha(run.sha)}
                    </a>
                  ) : (
                    <span className="font-mono text-xs">{shortSha(run.sha)}</span>
                  )}
                </td>
                <td className="px-4 py-3 capitalize">{run.trigger}</td>
                <td className="px-4 py-3">{formatDuration(run.buildMinutes)}</td>
                <td className="px-4 py-3 text-text-muted-light dark:text-text-muted-dark">
                  <RelativeTime iso={run.startedAt ?? run.createdAt} />
                </td>
                <td className="px-4 py-3 text-right">
                  {!isTerminalRunStatus(run.status) ? (
                    <button
                      type="button"
                      disabled={cancellingId === run.id}
                      onClick={(event) => {
                        event.stopPropagation();
                        void cancelRun(run.id);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                      aria-label={`Cancel run ${shortSha(run.sha)}`}
                    >
                      <Square className="h-3 w-3" />
                      {cancellingId === run.id ? "Stopping…" : "Stop"}
                    </button>
                  ) : (
                    <span className="text-xs text-text-muted-light dark:text-text-muted-dark">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}