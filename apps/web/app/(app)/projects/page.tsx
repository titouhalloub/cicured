"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FolderGit2, Rocket, XCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { GitHubIcon } from "@/components/github-icon";
import { RelativeTime } from "@/components/relative-time";
import { StatusBadge } from "@/components/runs/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import type { ProjectSummary, RunSummary } from "@/lib/schemas";
import { fetchProjects, type RunsPage } from "@/lib/queries";

function ProjectCard({ project }: { project: ProjectSummary }) {
  const lastRunQuery = useQuery({
    queryKey: ["last-run", project.id],
    queryFn: () => apiFetch<RunsPage>(`/projects/${project.id}/runs?limit=1`),
  });
  const lastRun: RunSummary | undefined = lastRunQuery.data?.items[0];

  const triggerRun = useMutation({
    mutationFn: () =>
      apiFetch<RunSummary>(`/projects/${project.id}/run`, { method: "POST", body: "{}" }),
    onSuccess: () => {
      toast.success("Run queued", { description: project.repoFullName });
      void lastRunQuery.refetch();
    },
    onError: (error: Error) => {
      toast.error("Could not queue run", { description: error.message });
    },
  });

  return (
    <div className="card flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
          <GitHubIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">{project.repoFullName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-text-muted-light dark:text-text-muted-dark">
            <FolderGit2 className="h-3.5 w-3.5" />
            {project.defaultBranch}
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-black/5 pt-4 dark:border-white/10">
        {lastRunQuery.isLoading ? (
          <Skeleton className="h-6 w-32" />
        ) : lastRun ? (
          <div className="flex items-center gap-2 text-sm">
            <StatusBadge status={lastRun.status} />
            <RelativeTime iso={lastRun.createdAt} />
          </div>
        ) : (
          <span className="text-sm text-text-muted-light dark:text-text-muted-dark">No runs yet</span>
        )}

        <Button
          size="sm"
          className="gap-1.5 rounded-input bg-brand-primary text-white hover:bg-brand-primary/90"
          disabled={triggerRun.isPending}
          onClick={() => triggerRun.mutate()}
        >
          <Rocket className="h-4 w-4" />
          {triggerRun.isPending ? "Queueing..." : "Run now"}
        </Button>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: fetchProjects });

  return (
    <>
      <section>
        <h1 className="text-2xl font-medium">Projects</h1>
        <p className="mt-1 text-sm text-text-muted-light dark:text-text-muted-dark">
          Connected repositories and their latest run.
        </p>
      </section>

      <section>
        {projectsQuery.isLoading ? (
          <div className="grid gap-6 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-44 w-full rounded-3xl" />
            ))}
          </div>
        ) : projectsQuery.isError ? (
          <div className="card">
            <EmptyState
              icon={XCircle}
              headline="Could not load projects"
              subtext="The API did not answer. Check that it is running and try again."
            />
          </div>
        ) : !projectsQuery.data || projectsQuery.data.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={FolderGit2}
              headline="No projects yet"
              subtext="Connect a repository to start running builds against it."
            />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {projectsQuery.data.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}