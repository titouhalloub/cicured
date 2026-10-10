import { AlertTriangle, CheckCircle2, Circle, XCircle } from "lucide-react";
import { formatMs } from "@/lib/format";

/** One row of the runner's task breakdown (Spec §2 report shape). */
export interface TimelineTask {
  name: string;
  success: boolean;
  skipped: boolean;
  timedOut: boolean;
  durationMs: number;
  command: string;
}

function TaskIcon({ task }: { task: TimelineTask }) {
  if (task.skipped) {
    return (
      <Circle className="h-4 w-4 shrink-0 text-text-muted-light dark:text-text-muted-dark" />
    );
  }
  if (task.timedOut) {
    return <AlertTriangle className="h-4 w-4 shrink-0 text-brand-warning" />;
  }
  if (task.success) {
    return <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-success" />;
  }
  return <XCircle className="h-4 w-4 shrink-0 text-brand-error" />;
}

/**
 * Ordered task breakdown for a run. Non-interactive: it is a readout of what
 * the sandbox reported, not a control surface.
 */
export function TaskTimeline({ tasks }: { tasks: TimelineTask[] | null }) {
  if (!tasks || tasks.length === 0) {
    return (
      <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
        No task breakdown available for this run.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {tasks.map((task, index) => (
        <li key={`${task.name}-${index}`} className="flex items-center gap-3">
          <TaskIcon task={task} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{task.name}</p>
            <p
              className="truncate text-xs text-text-muted-light dark:text-text-muted-dark"
              title={task.command}
            >
              {task.command}
            </p>
          </div>
          <span className="shrink-0 text-xs text-text-muted-light dark:text-text-muted-dark">
            {formatMs(task.durationMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}
