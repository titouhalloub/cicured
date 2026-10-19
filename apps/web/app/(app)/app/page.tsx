"use client";
import { ArrowRight, CheckCircle2, Clock, DollarSign, PlayCircle, Rocket, XCircle } from "lucide-react";
import Link from "next/link";
import type { RunSummary } from "@sft/schemas";
import { EmptyState } from "@/components/empty-state";
import { RunsTable } from "@/components/runs/runs-table";
import { Skeleton } from "@/components/ui/skeleton";
import { useAllRuns, useUsageSummary } from "@/lib/queries";

interface StatCard {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  iconClass: string;
}

const STATS: StatCard[] = [
  { label: "Total runs (last 30d)", icon: PlayCircle, iconClass: "bg-brand-primary/10 text-brand-primary" },
  { label: "Pass rate", icon: CheckCircle2, iconClass: "bg-brand-success/10 text-brand-success" },
  { label: "Avg build time", icon: Clock, iconClass: "bg-brand-info/10 text-brand-info" },
  // TODO(M5): no aggregate feedback endpoint yet, so "Suggestions accepted"
  // stays an em dash. The other three are computed from the runs below.
  { label: "Suggestions accepted", icon: XCircle, iconClass: "bg-brand-warning/10 text-brand-warning" },
];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** `$0.0003` under $1, `$1.24` at or above — and plain `$0.00` for no spend. */
function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  return amount < 1 ? `$${amount.toFixed(4)}` : `$${amount.toFixed(2)}`;
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useAllRuns();
  const { data: usageSummary, isLoading: usageLoading } = useUsageSummary();
  // Degrade to zero on error OR an empty ledger — this card never blocks or toasts.
  const usage = usageSummary && usageSummary.totalCalls > 0 ? usageSummary : null;
  const spendValue = usageLoading ? "—" : formatUsd(usage?.totalCostUsd ?? 0);
  const spendCalls = usage?.totalCalls ?? 0;
  const spendSubtitle = usageLoading
    ? "—"
    : `${spendCalls} ${spendCalls === 1 ? "call" : "calls"} tracked`;
  const topModel = usage?.topModels[0]?.model;
  const runs: RunSummary[] = data?.runs ?? [];

  const now = Date.now();
  const thirtyDaysAgo = now - THIRTY_DAYS_MS;
  const recentRuns = runs.filter(
    (r) => new Date(r.createdAt).getTime() >= thirtyDaysAgo,
  );

  const totalRuns = recentRuns.length;
  const passed = recentRuns.filter((r) => r.status === "success").length;
  const passRate = totalRuns > 0 ? Math.round((passed / totalRuns) * 100) : null;
  const avgMinutes =
    recentRuns.length > 0
      ? recentRuns.reduce((sum, r) => sum + (r.buildMinutes ?? 0), 0) /
        recentRuns.length
      : null;

  const statValues: Record<string, string> = {
    "Total runs (last 30d)": String(totalRuns),
    "Pass rate": passRate != null ? `${passRate}%` : "—",
    "Avg build time": avgMinutes != null ? `${avgMinutes.toFixed(1)}m` : "—",
    "Suggestions accepted": "—",
  };

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
                  <span className="text-3xl font-medium">{statValues[stat.label] ?? "—"}</span>
                  <span className="text-xs text-text-muted-light dark:text-text-muted-dark">
                    — vs last period
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div className="card flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
            <DollarSign className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm text-text-muted-light dark:text-text-muted-dark">
              AI Spend
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-medium">{spendValue}</span>
            </div>
            <p className="truncate text-xs text-text-muted-light dark:text-text-muted-dark">
              {spendSubtitle}
            </p>
            {topModel ? (
              <p className="truncate text-xs text-text-muted-light dark:text-text-muted-dark">
                top: {topModel}
              </p>
            ) : null}
          </div>
        </div>
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
