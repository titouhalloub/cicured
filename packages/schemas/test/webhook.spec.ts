import { describe, expect, it } from "vitest";
import {
  GithubPushPayloadSchema,
  WebhookDeliveryResultSchema,
} from "../src/index";

describe("GithubPushPayloadSchema", () => {
  const validPayload = {
    ref: "refs/heads/main",
    after: "a".repeat(40),
    repository: {
      full_name: "acme/web",
      default_branch: "main",
    },
    installation: {
      id: 12345,
    },
  };

  it("accepts a minimal valid push payload", () => {
    const result = GithubPushPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject(validPayload);
  });

  it("rejects missing installation.id", () => {
    const payload = { ...validPayload, installation: { id: undefined } };
    const result = GithubPushPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects empty repository.full_name", () => {
    const payload = { ...validPayload, repository: { ...validPayload.repository, full_name: "" } };
    const result = GithubPushPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("passes through unknown fields", () => {
    const payload = { ...validPayload, extra: "should be preserved" };
    const result = GithubPushPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    // @ts-expect-error - extra field should exist due to passthrough
    expect(result.data.extra).toBe("should be preserved");
  });
});

describe("WebhookDeliveryResultSchema", () => {
  it("accepts duplicate status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "duplicate" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("duplicate");
  });

  it("accepts ignored status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "ignored" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("ignored");
  });

  it("accepts branch-filtered status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "branch-filtered" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("branch-filtered");
  });

  it("accepts no-matching-project status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "no-matching-project" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("no-matching-project");
  });

  it("accepts installation-mismatch status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "installation-mismatch" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("installation-mismatch");
  });

  it("accepts deduped status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "deduped" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe("deduped");
  });

  it("accepts queued status with runId", () => {
    const result = WebhookDeliveryResultSchema.safeParse({
      status: "queued",
      runId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("queued");
      if (result.data.status === "queued") {
        expect(result.data.runId).toBe("11111111-1111-4111-8111-111111111111");
      }
    }
  });

  it("rejects queued status without runId", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "queued" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = WebhookDeliveryResultSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });
});