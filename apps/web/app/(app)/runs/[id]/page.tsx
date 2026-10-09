"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { FileWarning, Lightbulb, ListChecks, XCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/runs/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { formatDuration, shortSha } from "@/lib/format";
import type { RunSummary } from "@/lib/schemas";
import { useProjects } from "@/lib/queries";

/**
 * Extra fields the report summary may carry once GET /runs/:id exposes them.
 * They are absent from RunSummary today, hence the local extension.
 */
interface RunReportExtras {
  tasks?: Array<{ name?: string; status?: string }>;
  findings?: Array<{ category?: string }>;
}

function taskNames(run: RunSummary & RunReportExtras): string[] {
  const fromTasks = (run.tasks ?? [])
    .map((task) => task.name ?? "")
    .filter((name) => name.length > 0);
  if (fromTasks.length > 0) return fromTasks;
  return (run.findings ?? [])
    .map((finding) => finding.category ?? "")
    .filter((category) => category.length > 0);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-text-muted-light dark:text-text-muted-dark">
        {label}
      </p>
      <div className="mt-1 truncate text-sm font-medium">{children}</div>
    </div>
  );
}

/** M4b-1 skeleton: header + task timeline + placeholders for the M4b-2 panes. */
export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const runQuery = useQuery({
    queryKey: ["run", runId],
    queryFn: () => apiFetch<RunSummary & RunReportExtras>(`/runs/${runId}`),
  });
  const projectsQuery = useProjects();

  if (runQuery.isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (runQuery.isError || !runQuery.data) {
    return (
      <section className="card">
        <EmptyState
          icon={XCircle}
          headline="Could not load this run"
          subtext="The run may have been removed, or the API did not answer."
        />
      </section>
    );
  }

  const run = runQuery.data;
  const project = projectsQuery.data?.find((candidate) => candidate.id === run.projectId);
  const names = taskNames(run);

  return (
    <>
      <section className="card">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-medium">Run {shortSha(run.sha)}</h1>
          <StatusBadge status={run.status} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label="Repository">{project?.repoFullName ?? "—"}</Field>
          <Field label="Branch">{run.branch}</Field>
          <Field label="Commit">
            {run.sha ? (
              <a
                href={`https://github.com/${project?.repoFullName ?? ""}/commit/${run.sha}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-brand-primary hover:underline"
              >
                {shortSha(run.sha)}
              </a>
            ) : (
              "—"
            )}
          </Field>
          <Field label="Trigger">{run.trigger}</Field>
          <Field label="Duration">{formatDuration(run.buildMinutes)}</Field>
          <Field label="Started">
            <RelativeTime iso={run.startedAt ?? run.createdAt} />
          </Field>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
          <ListChecks className="h-5 w-5 text-brand-primary" />
          Task timeline
        </h2>
        {names.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {names.map((name) => (
              <li key={name} className="flex items-center gap-3 text-sm">
                <span className="h-2 w-2 rounded-full bg-brand-primary" />
                {name}
              </li>
            ))}
          </ol>
        ) : (
          // TODO(M4b-2): populate from the S3 report summary (run.tasks) and,
          // failing that, from findings categories once they are exposed.
          <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
            No task breakdown yet - the run report is exposed with live logs in M4b-2.
          </p>
        )}
      </section>

      {/* TODO(M4b-2): live SSE log stream (GET /runs/:id/logs). */}
      <section className="card">
        <h2 className="mb-2 text-lg font-medium">Live logs</h2>
        <EmptyState
          icon={ListChecks}
          headline="Live logs"
          subtext="coming in M4b-2"
        />
      </section>

      {/* TODO(M4b-2): findings list from GET /runs/:id findings. */}
      <section className="card">
        <h2 className="mb-2 text-lg font-medium">Findings</h2>
        <EmptyState
          icon={FileWarning}
          headline="Findings"
          subtext="coming in M4b-2"
        />
      </section>

      {/* TODO(M4b-2): suggestion diffs + accept/reject feedback buttons. */}
      <section className="card">
        <h2 className="mb-2 text-lg font-medium">Suggestions</h2>
        <EmptyState
          icon={Lightbulb}
          headline="Suggestions"
          subtext="coming in M4b-2"
        />
      </section>
    </>
  );
}
