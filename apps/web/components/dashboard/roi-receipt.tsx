"use client";
import type { ComponentType } from "react";
import Link from "next/link";
import { Clock, DollarSign, PiggyBank, TrendingUp } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/runs/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd, shortSha } from "@/lib/format";
import { useRoiReceipt } from "@/lib/queries";
import type { RunStatus } from "@/lib/schemas";

const MUTED = "text-text-muted-light dark:text-text-muted-dark";
const DIVIDER = "border-black/5 dark:border-white/10";

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  iconClass,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  iconClass: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${iconClass}`}>
        <Icon className="h-6 w-6" />
      </span>
      <div className="min-w-0">
        <p className={`truncate text-sm ${MUTED}`}>{label}</p>
        <p className="text-3xl font-medium">{value}</p>
        <p className={`truncate text-xs ${MUTED}`}>{hint}</p>
      </div>
    </div>
  );
}

export function RoiReceipt() {
  const { data, isLoading, isError } = useRoiReceipt();

  if (isLoading) {
    return (
      <section className="flex flex-col gap-6">
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }

  if (isError || !data) {
    return (
      <section className="card">
        <h2 className="text-lg font-medium">ROI Receipt</h2>
        <p className={`mt-2 text-sm ${MUTED}`}>Could not load the ROI receipt. Try again shortly.</p>
      </section>
    );
  }

  const roi = data.roiMultiplier > 0 ? `${Math.round(data.roiMultiplier).toLocaleString("en-US")}×` : "—";

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-medium">ROI Receipt</h2>
        <p className={`mt-1 text-sm ${MUTED}`}>
          Free static findings plus paid AI spend. Time and savings are estimates: 20 min per bug at $50/h.
        </p>
      </div>

      {/* Top: four metric cards */}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Spend"
          value={formatUsd(data.totalSpend)}
          hint={`${data.totalCalls} ${data.totalCalls === 1 ? "AI call" : "AI calls"}`}
          icon={DollarSign}
          iconClass="bg-brand-primary/10 text-brand-primary"
        />
        <Metric
          label="Est. time saved"
          value={`${data.estimatedTimeSavedHours.toFixed(1)}h`}
          hint={`${data.totalBugsFound} ${data.totalBugsFound === 1 ? "bug" : "bugs"} found`}
          icon={Clock}
          iconClass="bg-brand-info/10 text-brand-info"
        />
        <Metric
          label="Est. savings"
          value={formatUsd(data.estimatedSavingsUsd)}
          hint="at $50 / dev hour"
          icon={PiggyBank}
          iconClass="bg-brand-success/10 text-brand-success"
        />
        <Metric
          label="ROI multiplier"
          value={roi}
          hint={data.totalSpend > 0 ? "savings ÷ spend" : "no AI spend yet"}
          icon={TrendingUp}
          iconClass="bg-brand-warning/10 text-brand-warning"
        />
      </div>

      {/* Middle: bugs by type */}
      <div className="card">
        <h3 className="mb-4 text-lg font-medium">Bugs Caught by Type</h3>
        {data.bugsByType.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No findings yet. Trigger a run to see them here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={`text-left text-xs uppercase tracking-wide ${MUTED}`}>
                  <th className="pb-2 font-medium">Category</th>
                  <th className="pb-2 font-medium">Rule</th>
                  <th className="pb-2 text-right font-medium">Bugs caught</th>
                  <th className="pb-2 text-right font-medium">AI cost</th>
                </tr>
              </thead>
              <tbody>
                {data.bugsByType.map((row) => (
                  <tr key={`${row.category}:${row.ruleId}`} className={`border-t ${DIVIDER}`}>
                    <td className="py-2 capitalize">{row.category}</td>
                    <td className="py-2 font-mono text-xs">{row.ruleId}</td>
                    <td className="py-2 text-right font-medium">{row.bugCount}</td>
                    <td className={`py-2 text-right ${row.aiCost === 0 ? MUTED : "font-medium"}`}>
                      {formatUsd(row.aiCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom: recent run receipts */}
      <div className="card">
        <h3 className="mb-4 text-lg font-medium">Recent Run Receipts</h3>
        {data.recentRuns.length === 0 ? (
          <p className={`text-sm ${MUTED}`}>No runs yet.</p>
        ) : (
          <ul className="flex flex-col">
            {data.recentRuns.map((run) => (
              <li key={run.runId} className={`border-t py-3 first:border-t-0 first:pt-0 ${DIVIDER}`}>
                <Link
                  href={`/app/runs/${run.runId}`}
                  className="flex flex-wrap items-center justify-between gap-3 hover:opacity-80"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusBadge status={run.status as RunStatus} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {run.repoFullName}{" "}
                        <span className="font-mono text-xs text-brand-primary">{shortSha(run.sha)}</span>
                      </p>
                      <p className={`text-xs ${MUTED}`}>
                        <RelativeTime iso={run.createdAt} /> · {run.bugCount}{" "}
                        {run.bugCount === 1 ? "bug" : "bugs"}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">{formatUsd(run.totalCostUsd)}</p>
                    <p className={`text-xs ${MUTED}`}>
                      {run.breakdown.length === 0
                        ? "No AI spend"
                        : run.breakdown.map((item) => `${item.category}: ${formatUsd(item.costUsd)}`).join(" · ")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
