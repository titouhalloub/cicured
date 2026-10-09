"use client";
import { useRouter } from "next/navigation";
import { RelativeTime } from "@/components/relative-time";
import { formatDuration, shortSha } from "@/lib/format";
import type { ProjectSummary, RunSummary } from "@/lib/schemas";
import { StatusBadge } from "./status-badge";

interface RunsTableProps {
  runs: RunSummary[];
  projects: ProjectSummary[];
}

/** Reusable runs table: row click navigates to /runs/[id]; commit opens GitHub. */
export function RunsTable({ runs, projects }: RunsTableProps) {
  const router = useRouter();
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
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const repoName = projectNameById.get(run.projectId);
            return (
              <tr
                key={run.id}
                onClick={() => router.push(`/runs/${run.id}`)}
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}