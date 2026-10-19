import { Throttle } from "@nestjs/throttler";
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
  FeedbackInput,
  ListRunsQuery,
  type RunSummary,
} from "@sft/schemas";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionGuard } from "../auth/session.guard";
import { toRunSummary } from "../common/dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { UserRow } from "../db";
import { RunsService, type FindingWithCost, type SuggestionWithId } from "./runs.service";

/** Run lifecycle endpoints (Spec §6). */
@Controller()
@UseGuards(SessionGuard)
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  /**
   * POST /projects/:id/run - creates a queued run + BullMQ job.
   *
   * Tightest limit in the app: every call can mint a sandbox, so it is capped
   * well below the global 60/min (M5 §9).
   */
  @Post("projects/:id/run")
  @HttpCode(202)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  /** GET /runs/:id/findings — parser output for a run (Spec §4 step 8). */
  @Get("runs/:id/findings")
  async getFindings(
    @CurrentUser() user: UserRow,
    @Param("id") runId: string,
  ): Promise<FindingWithCost[]> {
    return this.runsService.findingsForRun(user, runId);
  }

  /**
   * GET /runs/:id/suggestions — LLM drafts for a run (Spec §6/§7). The shape is
   * wider than the `Suggestion` schema: id/findingId/createdAt are DB columns.
   */
  @Get("runs/:id/suggestions")
  async getSuggestions(
    @CurrentUser() user: UserRow,
    @Param("id") runId: string,
  ): Promise<SuggestionWithId[]> {
    return this.runsService.suggestionsForRun(user, runId);
  }

  /**
   * POST /suggestions/:id/feedback — accept/reject a suggestion
   * (Spec §4 step 11). Never auto-applies the patch.
   */
  @Post("suggestions/:id/feedback")
  @UseGuards(SessionGuard)
  async feedback(
    @CurrentUser() user: UserRow,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(FeedbackInput)) body: FeedbackInput,
  ): Promise<{ ok: true }> {
    return this.runsService.recordFeedback(user.id, id, body.accepted);
  }
}
