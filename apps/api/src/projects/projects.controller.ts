import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CreateProjectInput, type ProjectSummary } from "@sft/schemas";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionGuard } from "../auth/session.guard";
import { toProjectSummary } from "../common/dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { UserRow } from "../db";
import { ProjectsService } from "./projects.service";

/** POST /projects (Spec §6). */
@Controller("projects")
@UseGuards(SessionGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  async create(
    @CurrentUser() user: UserRow,
    @Body(new ZodValidationPipe(CreateProjectInput)) body: CreateProjectInput,
  ): Promise<ProjectSummary> {
    const row = await this.projects.createForUser(user.id, body);
    return toProjectSummary(row);
  }
}
