import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ListReposQuery, type RepoSummary } from "@sft/schemas";
import type { GitHubClient } from "../auth/github.client";
import { SessionGuard } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";

/**
 * GET /repos (Spec §6). Repos are listed per GitHub App installation with a
 * short-lived installation token; user OAuth tokens are never persisted (§8).
 */
@Controller("repos")
@UseGuards(SessionGuard)
export class ReposController {
  constructor(private readonly github: GitHubClient) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ListReposQuery)) query: ListReposQuery,
  ): Promise<RepoSummary[]> {
    return this.github.listInstallationRepos(query.installationId);
  }
}
