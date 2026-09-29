import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { CreateProjectInput } from "@sft/schemas";
import { and, eq } from "drizzle-orm";
import type { CryptoService } from "../common/crypto.service";
import { DRIZZLE, projects, type Database, type ProjectRow } from "../db";
import type { GitHubClient } from "../auth/github.client";

/** Postgres unique-violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly github: GitHubClient,
  ) {}

  async createForUser(userId: string, input: CreateProjectInput): Promise<ProjectRow> {
    const defaultBranch =
      input.defaultBranch ??
      (this.github.appConfigured
        ? await this.github.getRepoDefaultBranch(input.installationId, input.repoFullName)
        : "main");

    try {
      const [row] = await this.db
        .insert(projects)
        .values({
          userId,
          provider: "github",
          repoFullName: input.repoFullName,
          installationIdEnc: this.crypto.encrypt(String(input.installationId)),
          defaultBranch,
        })
        .returning();
      if (!row) throw new Error("project insert returned no row");
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("a project for this repository already exists");
      }
      throw error;
    }
  }

  /** Ownership check used by every project/run endpoint. */
  async findOwned(userId: string, projectId: string): Promise<ProjectRow | null> {
    const [row] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Decrypts the installation id - only call where a token is actually minted. */
  installationIdOf(row: ProjectRow): number {
    const parsed = Number(this.crypto.decrypt(row.installationIdEnc));
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error("stored installation id is invalid");
    }
    return parsed;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
