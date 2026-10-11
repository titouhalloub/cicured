"use client";
import { PlayCircle, XCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { RunsTable } from "@/components/runs/runs-table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllRuns } from "@/lib/queries";

/**
 * All runs across projects.
 *
 * The API has no aggregate list endpoint yet: `useAllRuns` fetches
 * `/projects` and then fans out to `/projects/:id/runs` (known N+1).
 * TODO(M5): add GET /runs?limit=50 to API.
 */
export default function RunsPage() {
  const { data, isLoading, isError, refetch } = useAllRuns();

  return (
    <>
      <section>
        <h1 className="text-2xl font-medium">Runs</h1>
        <p className="mt-1 text-sm text-text-muted-light dark:text-text-muted-dark">
          Every build across your connected repositories, newest first.
        </p>
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
