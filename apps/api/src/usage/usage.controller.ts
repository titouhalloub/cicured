import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { LlmCallRecord, UsageSummary } from "@sft/schemas";
import { z } from "zod";
import { CurrentUser } from "../auth/current-user.decorator";
import { DeviceTokenGuard } from "../auth/device-token.guard";
import { SessionGuard } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import type { UserRow } from "../db";
import { UsageService, type SyncLlmCall } from "./usage.service";

/**
 * Body of POST /usage/llm-calls: a batch of the CLI's local ledger records.
 *
 * `runId` is deliberately a plain optional string — a placeholder or stale id
 * is stored as NULL by UsageService instead of failing the entire upload.
 * The batch is capped so a single throttled request stays cheap.
 */
const SyncLlmCallsBody = z.object({
  records: z.array(LlmCallRecord.extend({ runId: z.string().optional() })).min(1).max(1000),
});
type SyncLlmCallsBody = z.infer<typeof SyncLlmCallsBody>;

/** LLM usage ledger upload consumed by `sft sync` (open-core Phase 3). */
@Controller("usage")
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  /**
   * POST /usage/llm-calls — bulk-append ledger records for the caller.
   * Auth: `Authorization: Bearer <SFT_DEVICE_TOKEN>` (dev-mode) or a session
   * cookie (DeviceTokenGuard falls back to SessionGuard).
   */
  @Post("llm-calls")
  @UseGuards(DeviceTokenGuard)
  @HttpCode(201)
  async recordLlmCalls(
    @CurrentUser() user: UserRow,
    @Body(new ZodValidationPipe(SyncLlmCallsBody)) body: SyncLlmCallsBody,
  ): Promise<{ inserted: number }> {
    return this.usageService.insertLlmCalls(user, body.records as SyncLlmCall[]);
  }

  /**
   * GET /usage/summary — cost totals for the dashboard card.
   * Session-only: browsers are the caller, so this guard sits on the route
   * itself and a device bearer token is not accepted here.
   */
  @Get("summary")
  @UseGuards(SessionGuard)
  async getUsageSummary(@CurrentUser() user: UserRow): Promise<UsageSummary> {
    return this.usageService.getSummary(user);
  }
}