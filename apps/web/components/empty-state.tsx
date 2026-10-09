interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  headline: string;
  subtext: string;
  /** Optional CTA rendered below the subtext. */
  action?: React.ReactNode;
}

/** Centered placeholder for empty lists / not-yet-built sections. */
export function EmptyState({ icon: Icon, headline, subtext, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-base font-medium">{headline}</p>
      <p className="max-w-sm text-sm text-text-muted-light dark:text-text-muted-dark">{subtext}</p>
      {action}
    </div>
  );
}
