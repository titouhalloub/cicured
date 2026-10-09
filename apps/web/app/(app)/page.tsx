"use client";
import { ArrowRight, CheckCircle2, Clock, PlayCircle, Rocket, XCircle } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { RunsTable } from "@/components/runs/runs-table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllRuns } from "@/lib/queries";

interface StatCard {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
}

// TODO(M5): real stats - there is no aggregate metrics endpoint yet, so every
// value and delta below is stubbed with an em dash for M4b-1.
const STATS: StatCard[] = [
  { label: "Total runs (last 30d)", icon: PlayCircle, iconClass: "bg-brand-primary/10 text-brand-primary" },
  { label: "Pass rate", icon: CheckCircle2, iconClass: "bg-brand-success/10 text-brand-success" },
  { label: "Avg build time", icon: Clock, iconClass: "bg-brand-info/10 text-brand-info" },
  { label: "Suggestions accepted", icon: XCircle, iconClass: "bg-brand-warning/10 text-brand-warning" },
];

export default function DashboardPage() {
  const { data, isLoading, isError } = useAllRuns();

  return (
    <>
      <section>
        <h1 className="text-2xl font-medium">Dashboard</h1>
        <p className="mt-1 text-sm text-text-muted-light dark:text-text-muted-dark">
          Build &amp; repair activity across your repositories.
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="card flex items-center gap-4">
              <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${stat.iconClass}`}>
                <Icon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm text-text-muted-light dark:text-text-muted-dark">
                  {stat.label}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-medium">—</span>
                  <span className="text-xs text-text-muted-light dark:text-text-muted-dark">
                    — vs last period
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent runs</h2>
          <Link
            href="/runs"
            className="flex items-center gap-1 text-sm font-medium text-brand-primary hover:underline"
          >
            View all
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={XCircle}
            headline="Could not load runs"
            subtext="The API did not answer. Check that it is running and try again."
          />
        ) : !data || data.runs.length === 0 ? (
          <EmptyState
            icon={Rocket}
            headline="No runs yet"
            subtext="Connect a project and trigger your first run to see it here."
            action={
              <Link href="/projects" className="text-sm font-medium text-brand-primary hover:underline">
                Go to projects
              </Link>
            }
          />
        ) : (
          <RunsTable runs={data.runs.slice(0, 10)} projects={data.projects} />
        )}
      </section>
    </>
  );
}
