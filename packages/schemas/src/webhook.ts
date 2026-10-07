import { z } from "zod";

/**
 * Minimal GitHub push payload we consume (Spec §6 webhook).
 * Uses .passthrough() so unknown fields don't reject — we only need a subset.
 */
export const GithubPushPayloadSchema = z
  .object({
    ref: z.string().min(1),
    after: z.string().min(1).max(64),
    repository: z.object({
      full_name: z.string().min(1),
      default_branch: z.string().min(1),
    }),
    installation: z.object({
      id: z.number().int().positive(),
    }),
  })
  .passthrough();

export type GithubPushPayload = z.infer<typeof GithubPushPayloadSchema>;

/**
 * Webhook delivery response — discriminated union for every valid outcome.
 * All valid paths return 200 with a status discriminator.
 */
export const WebhookDeliveryResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("duplicate") }),
  z.object({ status: z.literal("ignored") }),
  z.object({ status: z.literal("branch-filtered") }),
  z.object({ status: z.literal("no-matching-project") }),
  z.object({ status: z.literal("installation-mismatch") }),
  z.object({ status: z.literal("deduped") }),
  z.object({
    status: z.literal("queued"),
    runId: z.string().uuid(),
  }),
]);

export type WebhookDeliveryResult = z.infer<typeof WebhookDeliveryResultSchema>;