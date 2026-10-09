"use client";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./api";
import type { ProjectSummary, RunSummary } from "./schemas";

/** Shape of GET /projects/:id/runs (Spec §6). */
export interface RunsPage {
  items: RunSummary[];
  total: number;
  limit: number;
  offset: number;
}

export function fetchProjects(): Promise<ProjectSummary[]> {
  return apiFetch<ProjectSummary[]>("/projects");
}

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: fetchProjects });
}

/**
 * All runs across every project, newest first.
 *
 * TODO(M5): add GET /runs?limit=50 to API — there is no aggregate runs
 * endpoint today, so this fans out to GET /projects/:id/runs per project
 * (a known N+1; bounded by the user's project count).
 */
export async function fetchAllRuns(): Promise<{
  projects: ProjectSummary[];
  runs: RunSummary[];
}> {
  const projects = await fetchProjects();
  const pages = await Promise.all(
    projects.map((project) => apiFetch<RunsPage>(`/projects/${project.id}/runs?limit=50`)),
  );
  const runs = pages.flatMap((page) => page.items);
  runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { projects, runs };
}

export function useAllRuns() {
  return useQuery({ queryKey: ["runs"], queryFn: fetchAllRuns });
}
