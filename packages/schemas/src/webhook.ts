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

/**
 * Diff-scoped PR review (v2). `position` is GitHub's legacy diff offset —
 * lines down from the file's FIRST `@@` hunk header — NOT a line number.
 */
export const PrReviewComment = z.object({
  path: z.string(),
  position: z.number().int().positive(), // The GitHub API 'position' (not line number!)
  body: z.string().min(1),
});
export type PrReviewComment = z.infer<typeof PrReviewComment>;

export const PrReviewResult = z.object({
  summary: z.string(),
  comments: z.array(PrReviewComment),
});
export type PrReviewResult = z.infer<typeof PrReviewResult>;

/**
 * Minimal GitHub pull_request payload we consume (v2 PR review). Reviews run
 * on `opened` and `synchronize` (re-review after a pushed commit); every other
 * action is ignored. `.passthrough()` like the push payload.
 */
export const GithubPullRequestPayloadSchema = z
  .object({
    action: z.string().min(1),
    number: z.number().int().positive(),
    pull_request: z.object({
      head: z.object({ sha: z.string().min(1).max(64) }),
    }),
    repository: z.object({
      full_name: z.string().min(1),
    }),
    installation: z.object({
      id: z.number().int().positive(),
    }),
  })
  .passthrough();

export type GithubPullRequestPayload = z.infer<typeof GithubPullRequestPayloadSchema>;