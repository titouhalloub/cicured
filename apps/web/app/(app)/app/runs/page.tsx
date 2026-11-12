"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isTerminalRunStatus } from "@sft/schemas";
import { PlayCircle, Square, XCircle } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { RunsTable } from "@/components/runs/runs-table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllRuns } from "@/lib/queries";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";

/**
 * All runs across projects.
 *
 * The API has no aggregate list endpoint yet: `useAllRuns` fetches
 * `/projects` and then fans out to `/projects/:id/runs` (known N+1).
 * TODO(M5): add GET /runs?limit=50 to API.
 */
export default function RunsPage() {
  const { data, isLoading, isError, refetch } = useAllRuns();
  const queryClient = useQueryClient();
  const [stoppingAll, setStoppingAll] = useState(false);
  const activeCount = data?.runs.filter((run) => !isTerminalRunStatus(run.status)).length ?? 0;

  async function stopAll() {
    setStoppingAll(true);
    try {
      const result = await apiFetch<{ cancelled: number; remaining: number }>("/runs/cancel-all", { method: "POST" });
      toast.success("Stopped " + result.cancelled + " run(s)");
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
    } catch {
      toast.error("Could not stop active runs");
    } finally {
      setStoppingAll(false);
    }
  }

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Runs</h1>
          <p className="mt-1 text-sm text-text-muted-light dark:text-text-muted-dark">
            Every build across your connected repositories, newest first.
          </p>
        </div>
        {activeCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            disabled={stoppingAll}
            onClick={() => void stopAll()}
            className="border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
          >
            <Square />
            {stoppingAll ? "Stopping…" : "Stop all (" + activeCount + ")"}
          </Button>
        ) : null}
      </section>

      <section className="card">
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={XCircle}
            headline="Could not load runs"
            subtext="The API did not answer. Check that it is running and try again."
            action={
              <button
                type="button"
                onClick={() => void refetch()}
                className="text-sm font-medium text-brand-primary hover:underline"
              >
                Retry
              </button>
            }
          />
        ) : !data || data.runs.length === 0 ? (
          <EmptyState
            icon={PlayCircle}
            headline="No runs yet"
            subtext="Trigger a run from the projects page and it will appear here."
          />
        ) : (
          <RunsTable runs={data.runs.slice(0, 50)} projects={data.projects} />
        )}
      </section>
    </>
  );
}
