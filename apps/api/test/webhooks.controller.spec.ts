import {
  BadRequestException,
  UnauthorizedException,
  type RawBodyRequest,
} from "@nestjs/common";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { WebhooksController } from "../src/webhooks/webhooks.controller";
import type { WebhooksService } from "../src/webhooks/webhooks.service";

const VALID_SIGNATURE = `sha256=${"a".repeat(64)}`;
const RAW = Buffer.from(JSON.stringify({ ref: "refs/heads/main" }), "utf8");

function requestDouble(rawBody?: Buffer): RawBodyRequest<Request> {
  return (rawBody === undefined ? {} : { rawBody }) as unknown as RawBodyRequest<Request>;
}

interface StubOverrides {
  verifySignature?: (raw: Buffer, signature: string | undefined) => boolean;
  recordDelivery?: (deliveryId: string, raw: Buffer) => Promise<boolean>;
  handleGithubPush?: (raw: Buffer) => Promise<{ status: string; runId?: string }>;
}

function controllerStub(overrides: StubOverrides = {}) {
  const webhooks = {
    verifySignature: vi.fn(
      overrides.verifySignature ?? ((_raw: Buffer, sig?: string) => sig === VALID_SIGNATURE),
    ),
    recordDelivery: vi.fn(
      overrides.recordDelivery ?? (async (_deliveryId: string, _raw: Buffer) => true),
    ),
    handleGithubPush: vi.fn(
      overrides.handleGithubPush ??
        (async (_raw: Buffer) => ({ status: "queued", runId: "run-1" })),
    ),
  };
  return {
    controller: new WebhooksController(webhooks as unknown as WebhooksService),
    webhooks,
  };
}

describe("WebhooksController", () => {
  it("returns 401 for a missing signature", async () => {
    const { controller: ctl } = controllerStub();

    await expect(
      ctl.github(requestDouble(RAW), undefined, "push", "delivery-1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("returns 401 for a bad signature", async () => {
    const { controller: ctl } = controllerStub();

    await expect(
      ctl.github(requestDouble(RAW), `sha256=${"0".repeat(64)}`, "push", "delivery-1"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns {status:"duplicate"} when recordDelivery returns false', async () => {
    const { controller: ctl, webhooks } = controllerStub({
      recordDelivery: async () => false,
    });

    const result = await ctl.github(
      requestDouble(RAW),
      VALID_SIGNATURE,
      "push",
      "delivery-1",
    );

    expect(result).toEqual({ status: "duplicate" });
    expect(webhooks.handleGithubPush).not.toHaveBeenCalled();
  });

  it('returns {status:"ignored"} for non-push events', async () => {
    const { controller: ctl, webhooks } = controllerStub();

    const result = await ctl.github(
      requestDouble(RAW),
      VALID_SIGNATURE,
      "issues",
      "delivery-1",
    );

    expect(result).toEqual({ status: "ignored" });
    expect(webhooks.handleGithubPush).not.toHaveBeenCalled();
  });

  it("delegates to handleGithubPush for a valid push event", async () => {
    const { controller: ctl, webhooks } = controllerStub();

    const result = await ctl.github(
      requestDouble(RAW),
      VALID_SIGNATURE,
      "push",
      "delivery-1",
    );

    expect(result).toEqual({ status: "queued", runId: "run-1" });
    expect(webhooks.handleGithubPush).toHaveBeenCalledWith(RAW);
    expect(webhooks.recordDelivery).toHaveBeenCalledWith("delivery-1", RAW);
  });

  it("throws BadRequestException when rawBody is missing", async () => {
    const { controller: ctl } = controllerStub();

    await expect(
      ctl.github(requestDouble(undefined), VALID_SIGNATURE, "push", "delivery-1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});