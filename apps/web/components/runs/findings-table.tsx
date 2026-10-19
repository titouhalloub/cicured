"use client";

import { useState } from "react";
import { FileWarning } from "lucide-react";
import type { Finding, FindingSeverity } from "@sft/schemas";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The API row carries an `id`; the shared `Finding` schema does not. The
 * fingerprint is unique per run (`findings_run_fingerprint_uq`), so it is the
 * fallback key. `costUsd` is the summed LLM spend for this finding.
 */
type FindingRow = Finding & { id?: string; costUsd?: number };

const SEVERITY_DOT: Record<FindingSeverity, string> = {
  error: "bg-brand-error",
  warning: "bg-brand-warning",
  info: "bg-brand-info",
};

const SEVERITY_FILTERS: FindingSeverity[] = ["error", "warning", "info"];

type Filter = FindingSeverity | "All";

function chipLabel(value: Filter): string {
  return value === "All" ? "All" : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

/**
 * Flat, sorted findings table. Deliberately NOT grouped by file: the API
 * already orders by severity DESC, file ASC, line ASC (Spec §5), and that
 * ordering is what a reviewer wants to read top-down.
 */
export function FindingsTable({ findings, loading }: { findings: FindingRow[]; loading: boolean }) {
  const [filter, setFilter] = useState<Filter>("All");
  const filtered =
    filter === "All" ? findings : findings.filter((finding) => finding.severity === filter);

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <EmptyState
        icon={FileWarning}
        headline="No findings"
        subtext="This run passed cleanly."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(["All", ...SEVERITY_FILTERS] as Filter[]).map((value) => {
          const count =
            value === "All"
              ? findings.length
              : findings.filter((finding) => finding.severity === value).length;
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={active}
              className={cn(
                "badge-status rounded-full px-2.5 py-1 text-xs transition-colors",
                active
                  ? "bg-brand-primary text-white"
                  : "bg-black/5 text-text-muted-light hover:bg-brand-primary/10 dark:bg-white/10 dark:text-text-muted-dark",
              )}
            >
              {chipLabel(value)} ({count})
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
          No findings match this filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 text-left text-xs uppercase tracking-wide text-text-muted-light dark:border-white/10 dark:text-text-muted-dark">
                <th className="pb-2 pr-3 font-medium">Severity</th>
                <th className="pb-2 pr-3 font-medium">Category</th>
                <th className="pb-2 pr-3 font-medium">File:Line</th>
                <th className="pb-2 pr-3 font-medium">Rule</th>
                <th className="pb-2 font-medium">Message</th>
                <th className="pb-2 pl-3 text-right font-medium">AI Cost</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((finding) => (
                <tr
                  key={finding.id ?? finding.fingerprint}
                  className="border-b border-black/5 align-top last:border-0 dark:border-white/10"
                >
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          SEVERITY_DOT[finding.severity],
                        )}
                      />
                      {finding.severity}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="badge-status rounded-full bg-black/5 px-2 py-0.5 text-xs dark:bg-white/10">
                      {finding.category}
                    </span>
                  </td>
                  <td
                    className="max-w-[200px] truncate py-2 pr-3 font-mono text-xs"
                    title={`${finding.file}:${finding.line}:${finding.col}`}
                  >
                    {finding.file}:{finding.line}:{finding.col}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="badge-status rounded-full bg-black/5 px-2 py-0.5 font-mono text-xs dark:bg-white/10">
                      {finding.ruleId}
                    </span>
                  </td>
                  <td className="max-w-[400px] py-2">{finding.message}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums">
                    {finding.costUsd ? formatUsd(finding.costUsd) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
