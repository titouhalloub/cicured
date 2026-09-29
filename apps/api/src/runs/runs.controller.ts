import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  CreateRunInput,
  ListRunsQuery,
  type RunSummary,
} from "@sft/schemas";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionGuard } from "../auth/session.guard";
import { toRunSummary } from "../common/dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { UserRow } from "../db";
import type { RunsService } from "./runs.service";

/** Run lifecycle endpoints (Spec §6). */
@Controller()
@UseGuards(SessionGuard)
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  /** POST /projects/:id/run - creates a queued run + BullMQ job. */
  @Post("projects/:id/run")
  @HttpCode(202)
  async createRun(
    @CurrentUser() user: UserRow,
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(CreateRunInput)) body: CreateRunInput,
  ): Promise<RunSummary> {
    const row = await this.runsService.createManualRun(user, projectId, body);
    return toRunSummary(row);
  }

  /** GET /projects/:id/runs - newest first, paginated. */
  @Get("projects/:id/runs")
  async listRuns(
    @CurrentUser() user: UserRow,
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(ListRunsQuery)) query: ListRunsQuery,
  ): Promise<{ items: RunSummary[]; total: number; limit: number; offset: number }> {
    const { items, total } = await this.runsService.listProjectRuns(user, projectId, query);
    return { items: items.map(toRunSummary), total, limit: query.limit, offset: query.offset };
  }

  /** GET /runs/:id */
  @Get("runs/:id")
  async getRun(@CurrentUser() user: UserRow, @Param("id") runId: string): Promise<RunSummary> {
    return toRunSummary(await this.runsService.getOwnedRun(user, runId));
  }
}
