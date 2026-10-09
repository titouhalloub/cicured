import type { RunStatus } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Pill styles per run status (Spec §5): success=green, failed=red,
 * running=blue pulse, queued=amber, runner_crash=red outline.
 */
export const STATUS_BADGE_STYLES: Record<RunStatus, { label: string; className: string }> = {
  queued: {
    label: "Queued",
    className: "bg-brand-warning/15 text-brand-warning",
  },
  running: {
    label: "Running",
    className: "bg-brand-info/15 text-brand-info animate-pulse",
  },
  success: {
    label: "Success",
    className: "bg-brand-success/15 text-brand-success",
  },
  failed: {
    label: "Failed",
    className: "bg-brand-error/15 text-brand-error",
  },
  runner_crash: {
    label: "Crashed",
    className: "border border-brand-error bg-transparent text-brand-error",
  },
  timeout: {
    label: "Timeout",
    className: "bg-brand-warning/15 text-brand-warning",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-card-light/70 dark:bg-card-dark/70 text-text-muted-light dark:text-text-muted-dark",
  },
};

export function StatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const style = STATUS_BADGE_STYLES[status];
  return <span className={cn("badge-status", style.className, className)}>{style.label}</span>;
}
