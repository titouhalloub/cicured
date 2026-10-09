import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { CreateProjectInput, type ProjectSummary } from "@sft/schemas";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionGuard } from "../auth/session.guard";
import { toProjectSummary } from "../common/dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { UserRow } from "../db";
import { ProjectsService } from "./projects.service";

/** Project lifecycle endpoints (Spec §6). */
@Controller("projects")
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /** GET /projects - the user's connected repos, newest first. */
  @Get()
  @UseGuards(SessionGuard)
  async list(@CurrentUser() user: UserRow): Promise<ProjectSummary[]> {
    return this.projects.listForUser(user.id);
  }

  /** POST /projects - connect a repo. */
  @Post()
  async create(
    @CurrentUser() user: UserRow,
    @Body(new ZodValidationPipe(CreateProjectInput)) body: CreateProjectInput,
  ): Promise<ProjectSummary> {
    const row = await this.projects.createForUser(user.id, body);
    return toProjectSummary(row);
  }
}
