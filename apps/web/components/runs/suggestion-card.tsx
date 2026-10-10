"use client";

import { Check, Loader2, X } from "lucide-react";
import type { Finding } from "@sft/schemas";
import { Button } from "@/components/ui/button";
import type { SuggestionWithId } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * One LLM suggestion with its accept/reject controls (Spec §4 step 11).
 *
 * The patch is only ever *displayed*: accepting records a verdict, it never
 * writes to the repository.
 */
export function SuggestionCard({
  suggestion,
  parentFinding,
  onFeedback,
  pending,
}: {
  suggestion: SuggestionWithId;
  /** The finding this suggestion answers, when the caller has it. */
  parentFinding?: Finding;
  onFeedback: (accepted: boolean) => void;
  pending: boolean;
}) {
  const lines = suggestion.patchDiff.split("\n");

  return (
    <article
      className={cn(
        "card flex flex-col gap-4",
        suggestion.accepted === true && "border border-brand-success",
        suggestion.accepted === false && "opacity-70",
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        {parentFinding ? (
          <span className="badge-status rounded-full bg-brand-primary/10 px-2 py-0.5 font-mono text-xs text-brand-primary">
            {parentFinding.ruleId}
          </span>
        ) : null}
        <span className="text-xs text-text-muted-light dark:text-text-muted-dark">
          {Math.round(suggestion.confidence * 100)}% confident
        </span>
        <span className="ml-auto text-xs text-text-muted-light dark:text-text-muted-dark">
          {suggestion.model}
        </span>
      </header>

      <pre className="overflow-x-auto rounded-input bg-black/5 p-3 font-mono text-xs dark:bg-white/5">
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              line.startsWith("@@") &&
                "text-text-muted-light dark:text-text-muted-dark",
              line.startsWith("+") &&
                !line.startsWith("+++") &&
                "bg-green-500/10",
              line.startsWith("-") &&
                !line.startsWith("---") &&
                "bg-red-500/10",
            )}
          >
            {line}
          </div>
        ))}
      </pre>

      <p className="text-sm text-text-muted-light dark:text-text-muted-dark">
        {suggestion.explanation}
      </p>

      <footer className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => onFeedback(true)}>
          {pending ? <Loader2 className="animate-spin" /> : <Check />}
          Accept
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onFeedback(false)}
        >
          {pending ? <Loader2 className="animate-spin" /> : <X />}
          Reject
        </Button>

        {suggestion.accepted === true ? (
          <span className="flex items-center gap-1 text-xs text-brand-success">
            <Check className="h-3.5 w-3.5" />
            Accepted
          </span>
        ) : null}
        {suggestion.accepted === false ? (
          <span className="flex items-center gap-1 text-xs text-brand-error">
            <X className="h-3.5 w-3.5" />
            Rejected
          </span>
        ) : null}
      </footer>
    </article>
  );
}
