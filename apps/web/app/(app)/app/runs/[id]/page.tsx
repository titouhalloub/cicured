"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { isTerminalRunStatus, type RunSummary } from "@sft/schemas";
import { FileWarning, Lightbulb, ListChecks, Play, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/runs/status-badge";
import { FindingsTable } from "@/components/runs/findings-table";
import { LiveLogViewer } from "@/components/runs/live-log-viewer";
import { SuggestionCard } from "@/components/runs/suggestion-card";
import { TaskTimeline } from "@/components/runs/task-timeline";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { formatDuration, formatUsd, shortSha } from "@/lib/format";
import {
  useFindings,
  useProjects,
  useRun,
  useSuggestionFeedback,
  useSuggestions,
} from "@/lib/queries";
import type { FindingWithId, SuggestionWithId } from "@/lib/schemas";

/**
 * Section wrapper. There is no `Card` primitive in this app — the shell uses
 * the `.card` utility class from `app/globals.css`, so that is what this
 * mirrors rather than inventing a component.
 */
function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-medium">
        {Icon ? <Icon className="h-5 w-5 text-brand-primary" /> : null}
        {title}
      </h2>
      {children}
    </section>
  );
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

function SkeletonPage() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

/** Header card: identity of the run plus the manual "Run now" trigger. */
function RunHeader({ run, repoFullName }: { run: RunSummary; repoFullName: string }) {
  const qc = useQueryClient();
  const [starting, setStarting] = useState(false);

  async function runNow() {
    setStarting(true);
    try {
      await apiFetch<RunSummary>(`/projects/${run.projectId}/run`, { method: "POST" });
      toast.success("Run queued");
      await qc.invalidateQueries({ queryKey: ["runs"] });
    } catch {
      toast.error("Could not start a run");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium">Run {shortSha(run.sha)}</h1>
          <StatusBadge status={run.status} />
        </div>
        <Button size="sm" disabled={starting} onClick={() => void runNow()}>
          <Play />
          {starting ? "Starting…" : "Run now"}
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Field label="Repository">{repoFullName}</Field>
        <Field label="Branch">{run.branch}</Field>
        <Field label="Commit">
          {run.sha ? (
            <a
              href={`https://github.com/${repoFullName}/commit/${run.sha}`}
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
  );
}

/** Suggestions, each paired with the finding it answers. */
function SuggestionsList({
  suggestions,
  findings,
  terminal,
}: {
  suggestions: SuggestionWithId[];
  findings: FindingWithId[];
  terminal: boolean;
}) {
  const feedback = useSuggestionFeedback();

  if (suggestions.length === 0) {
    return (
      <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
        {terminal
          ? "Suggestions are being generated or unavailable for this run."
          : "Suggestions are generated once the run finishes."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {suggestions.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          parentFinding={findings.find((finding) => finding.id === suggestion.findingId)}
          pending={feedback.isPending && feedback.variables?.id === suggestion.id}
          onFeedback={(accepted) => {
            feedback.mutate(
              { id: suggestion.id, accepted },
              {
                onSuccess: () =>
                  toast.success(accepted ? "Suggestion accepted" : "Suggestion rejected"),
                onError: () => toast.error("Could not submit feedback"),
              },
            );
          }}
        />
      ))}
    </div>
  );
}

export default function RunDetailPage() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  const runQuery = useRun(runId);
  const projectsQuery = useProjects();
  const terminal = runQuery.data ? isTerminalRunStatus(runQuery.data.status) : false;

  const findingsQuery = useFindings(runId, terminal);
  const suggestionsQuery = useSuggestions(runId, terminal);
  const findings = findingsQuery.data ?? [];
/* eslint-disable @typescript-eslint/no-unused-vars */
const totalCost = findings.reduce((sum, f) => sum + (f.costUsd || 0), 0);

/* eslint-enable @typescript-eslint/no-unused-vars */
// removed

  if (runQuery.isLoading) return <SkeletonPage />;

  if (runQuery.isError || !runQuery.data) {
    return (
      <section className="card">
        <EmptyState
          icon={XCircle}
          headline="Could not load this run"
          subtext="The run may have been removed, or the API did not answer."
          action={
            <Button variant="outline" size="sm" onClick={() => void runQuery.refetch()}>
              <RefreshCw />
              Retry
            </Button>
          }
        />
      </section>
    );
  }

  const run = runQuery.data;
  const repoFullName =
    projectsQuery.data?.find((project) => project.id === run.projectId)?.repoFullName ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <RunHeader run={run} repoFullName={repoFullName} />

      <Card title="Task timeline" icon={ListChecks}>
        {run.tasks && run.tasks.length > 0 ? (
          <TaskTimeline tasks={run.tasks} />
        ) : (
          <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
            No task breakdown available
          </p>
        )}
      </Card>

      <Card title="Live logs">
        <LiveLogViewer runId={runId} enabled={!terminal} />
      </Card>

      <Card title="Findings" icon={FileWarning}>
        <div className="mb-3 flex justify-end">
          <span className="badge-status rounded-full bg-black/5 px-2.5 py-1 text-xs text-text-muted-light dark:bg-white/10 dark:text-text-muted-dark">
            Total AI Cost for this run: {formatUsd(run.totalCostUsd ?? 0)}
          </span>
        </div>
        <FindingsTable findings={findings} loading={findingsQuery.isLoading} />
      </Card>

      <Card title="Suggestions" icon={Lightbulb}>
        <SuggestionsList
          suggestions={suggestionsQuery.data ?? []}
          findings={findings}
          terminal={terminal}
        />
      </Card>
    </div>
  );
}
