import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { WebhooksService } from "./webhooks.service";

/**
 * POST /webhooks/github - GitHub push receiver (M2b-2c).
 *
 * Signature verification runs over `req.rawBody` (enabled via
 * `rawBody: true` in main.ts): Nest's JSON parser would otherwise destroy
 * the exact bytes the HMAC was computed over.
 */
@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post("github")
  @HttpCode(200)
  async github(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Headers("x-github-event") event: string | undefined,
    @Headers("x-github-delivery") deliveryId: string | undefined,
  ): Promise<{ status: string; runId?: string }> {
    const raw = req.rawBody;
    if (!raw) throw new BadRequestException("raw body not captured");
    if (!deliveryId) throw new BadRequestException("missing x-github-delivery");

    if (!this.webhooks.verifySignature(raw, signature)) {
      throw new UnauthorizedException("invalid signature");
    }

    const isNew = await this.webhooks.recordDelivery(deliveryId, raw);
    if (!isNew) return { status: "duplicate" };

    if (event !== "push") return { status: "ignored" };

    return this.webhooks.handleGithubPush(raw);
  }
}