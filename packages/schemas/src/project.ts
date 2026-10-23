import { z } from "zod";
import { isIsoDateTime, UUID_PATTERN } from "./common";
import { SftTaskV2 } from "./report";
import { FailureKind, RunStatus, RunTrigger } from "./run";

/** `<owner>/<repo>` — GitHub allows alphanumerics plus `- _ .` in both parts. */
export const REPO_FULL_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-_.]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

export const RepoFullName = z
  .string()
  .regex(REPO_FULL_NAME_PATTERN, { message: "must be <owner>/<repo>" });

const Uuid = z.string().regex(UUID_PATTERN, { message: "must be a UUID" });
const Iso = z
  .string()
  .refine(isIsoDateTime, { message: "must be a valid ISO-8601 timestamp" });

/** POST /projects body. */
export const CreateProjectInput = z.object({
  installationId: z.number().int().positive(),
  repoFullName: RepoFullName,
  /** Omitted => resolved from the GitHub App installation, falling back to the repo default branch. */
  defaultBranch: z.string().min(1).max(255).optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

/** POST /projects/:id/run body (manual trigger in M1). */
export const CreateRunInput = z.object({
  branch: z.string().min(1).max(255).optional(),
  sha: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/i, { message: "must be a git commit sha" })
    .optional(),
});
export type CreateRunInput = z.infer<typeof CreateRunInput>;

/** GET /projects/:id/runs query. */
export const ListRunsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuery>;

export const ProjectSummary = z.object({
  id: Uuid,
  provider: z.literal("github"),
  repoFullName: RepoFullName,
  defaultBranch: z.string(),
  createdAt: Iso,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const RunSummary = z.object({
  id: Uuid,
  projectId: Uuid,
  /** Null until the worker resolves HEAD (M2). */
  sha: z.string().nullable(),
  branch: z.string(),
  trigger: RunTrigger,
  status: RunStatus,
  exitCode: z.number().int().nullable(),
  failureKind: FailureKind.nullable(),
  createdAt: Iso,
  startedAt: Iso.nullable(),
  finishedAt: Iso.nullable(),
  buildMinutes: z.number().int().nullable(),
  /** Task breakdown from the validated report (S3). Populated only by GET /runs/:id;
   * left undefined by the list endpoint to avoid per-run S3 fetches. */
  tasks: z.array(SftTaskV2).optional(),
  /** Sum of LLM call costs for this run, from the llm_calls ledger. */
  totalCostUsd: z.number().optional(),
});
export type RunSummary = z.infer<typeof RunSummary>;

/** GET/POST /auth/:provider/callback input (Spec §6). */
export const OAuthCallbackInput = z.object({
  code: z.string().min(1).max(300),
  state: z.string().min(1).max(300),
});
export type OAuthCallbackInput = z.infer<typeof OAuthCallbackInput>;

/** GET /auth/me and OAuth callback payload — never includes tokens or secrets. */
export const SessionUser = z.object({
  id: Uuid,
  email: z.string().nullable(),
  plan: z.string(),
  provider: z.literal("github"),
  createdAt: Iso,
});
export type SessionUser = z.infer<typeof SessionUser>;

/** GET /repos query - which GitHub App installation to list. */
export const ListReposQuery = z.object({
  installationId: z.coerce.number().int().positive(),
});
export type ListReposQuery = z.infer<typeof ListReposQuery>;

/** GET /repos response item (via GitHub App installation). */
export const RepoSummary = z.object({
  id: z.number().int(),
  fullName: RepoFullName,
  defaultBranch: z.string(),
  private: z.boolean(),
});
export type RepoSummary = z.infer<typeof RepoSummary>;
