import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { parseDiff } from "@sft/parser";
import { GithubPullRequestPayloadSchema, GithubPushPayloadSchema } from "@sft/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { GitHubClient } from "../auth/github.client";
import { CryptoService } from "../common/crypto.service";
import { AppConfig } from "../config/app-config.service";
import { DRIZZLE, llmCalls, projects, runs, webhookDeliveries, type Database } from "../db";
import { RunsQueue } from "../queue/runs-queue.service";
import { DiffReviewLlm } from "./diff-review.llm";

/** Hard caps that bound one webhook delivery's OpenRouter spend. */
const MAX_REVIEW_HUNKS = 25;
const MAX_REVIEW_COMMENTS = 30;

/** Pricing behind the cost receipt: USD per 1M tokens (input · output). */
const INPUT_TOKEN_USD_PER_M = 3.0;
const OUTPUT_TOKEN_USD_PER_M = 15.0;
/** Editorial estimate printed next to the cost — not a measured value. */
const TOKENS_SAVED_ESTIMATE = 15_000;

/**
 * GitHub webhooks (Spec §0 push trigger; M2b-2c): verify the HMAC, dedupe
 * deliveries, and fan a push event into a queued run. v2 adds diff-scoped
 * PR review on pull_request events (opened / synchronize).
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly config: AppConfig,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly queue: RunsQueue,
    private readonly github: GitHubClient,
    private readonly llm: DiffReviewLlm,
  ) {}

  /**
   * HMAC-SHA256 over the raw request bytes, compared in constant time.
   * The header format is `sha256=<64 hex chars>`; an unset secret or a
   * missing header fails closed.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = this.config.env.GITHUB_WEBHOOK_SECRET;
    if (!secret || !signatureHeader) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const provided = Buffer.from(signatureHeader, "utf8");
    const wanted = Buffer.from(expected, "utf8");
    // timingSafeEqual throws on a length mismatch, so gate on length first.
    if (provided.length !== wanted.length) return false;
    return timingSafeEqual(provided, wanted);
  }

  /**
   * Idempotency ledger: the (provider, delivery_id) unique index makes a
   * replayed delivery a no-op. Returns false only on Postgres unique
   * violation (23505); every other error is rethrown.
   */
  async recordDelivery(deliveryId: string, rawBody: Buffer): Promise<boolean> {
    const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
    try {
      await this.db.insert(webhookDeliveries).values({
        provider: "github",
        deliveryId,
        payloadSha256,
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * Full push pipeline: validate → branch filter → project lookup →
   * installation check → dedup → insert run → enqueue.
   *
   * Every failure mode maps to a status from WebhookDeliveryResult so the
   * response body documents what happened without leaking secrets.
   */
  async handleGithubPush(rawBody: Buffer): Promise<{ status: string; runId?: string }> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { status: "ignored" };
    }
    const parsed = GithubPushPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) return { status: "ignored" };
    const { ref, after, repository, installation } = parsed.data;

    if (ref !== `refs/heads/${repository.default_branch}`) {
      return { status: "branch-filtered" };
    }

    const [project] = await this.db
      .select()
      .from(projects)
      .where(
        and(eq(projects.provider, "github"), eq(projects.repoFullName, repository.full_name)),
      )
      .limit(1);
    if (!project) return { status: "no-matching-project" };

    let installationId: string;
    try {
      installationId = this.crypto.decrypt(project.installationIdEnc);
    } catch {
      // Never log the encrypted or decrypted values (Spec §8).
      this.logger.warn("webhook installation decrypt failed");
      return { status: "installation-mismatch" };
    }
    if (installationId !== String(installation.id)) {
      this.logger.warn("webhook installation id mismatch");
      return { status: "installation-mismatch" };
    }

    const [existing] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.projectId, project.id),
          eq(runs.sha, after),
          inArray(runs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (existing) return { status: "deduped" };

    const [run] = await this.db
      .insert(runs)
      .values({
        projectId: project.id,
        sha: after,
        branch: repository.default_branch,
        trigger: "push",
        status: "queued",
      })
      .returning({ id: runs.id });
    if (!run) throw new Error("run insert returned no row");

    await this.queue.enqueueRun({ runId: run.id, projectId: project.id });
    return { status: "queued", runId: run.id };
  }

  /**
   * pull_request pipeline (v2 combined): project + installation check (same
   * posture as push, so a random install cannot spend our LLM budget) →
   * enqueue the background sandbox run for the PR head → fetch the unified
   * diff → parse hunks → LLM review per hunk → post one review with inline
   * comments at GitHub `position` offsets plus a cost receipt footer.
   */
  async handleGithubPullRequest(rawBody: Buffer): Promise<{ status: string; runId?: string }> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { status: "ignored" };
    }
    const parsed = GithubPullRequestPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) return { status: "ignored" };
    const { action, number: prNumber, pull_request, repository, installation } = parsed.data;
    // Reviews run when the PR opens and again after each pushed commit.
    if (action !== "opened" && action !== "synchronize") return { status: "ignored" };

    const [project] = await this.db
      .select()
      .from(projects)
      .where(
        and(eq(projects.provider, "github"), eq(projects.repoFullName, repository.full_name)),
      )
      .limit(1);
    if (!project) return { status: "no-matching-project" };

    let installationId: string;
    try {
      installationId = this.crypto.decrypt(project.installationIdEnc);
    } catch {
      // Never log the encrypted or decrypted values (Spec §8).
      this.logger.warn("webhook installation decrypt failed");
      return { status: "installation-mismatch" };
    }
    if (installationId !== String(installation.id)) {
      this.logger.warn("webhook installation id mismatch");
      return { status: "installation-mismatch" };
    }

    const separator = repository.full_name.indexOf("/");
    if (separator <= 0 || separator === repository.full_name.length - 1) {
      return { status: "ignored" };
    }
    const owner = repository.full_name.slice(0, separator);
    const repo = repository.full_name.slice(separator + 1);
    const commitSha = pull_request.head.sha;
    const headBranch = pull_request.head.ref;

    // Background run first: the ~3 min sandbox must not wait behind the LLM
    // review loop. Best-effort — a queue hiccup must never block the review.
    let runId: string | undefined;
    try {
      runId = await this.enqueuePullRequestRun(project.id, commitSha, headBranch, prNumber);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(`PR run enqueue failed for ${repository.full_name}#${prNumber}: ${reason}`);
    }

    if (!this.github.appConfigured || !this.llm.enabled) {
      return { status: "review-disabled", ...(runId !== undefined ? { runId } : {}) };
    }

    const diff = await this.github.getPullRequestDiff(installation.id, owner, repo, prNumber);
    const hunks = parseDiff(diff);
    if (hunks.length === 0) {
      return { status: "no-diff", ...(runId !== undefined ? { runId } : {}) };
    }

    const summaries: string[] = [];
    const comments: Array<{ path: string; position: number; body: string }> = [];
    // Billed usage across every hunk — feeds the cost receipt footer.
    let inputTokens = 0;
    let outputTokens = 0;
    // Wall-clock of the review loop — stored as llm_calls.duration_ms.
    const reviewStartedAt = Date.now();
    for (const hunk of hunks.slice(0, MAX_REVIEW_HUNKS)) {
      let review: Awaited<ReturnType<DiffReviewLlm["reviewHunk"]>>;
      try {
        review = await this.llm.reviewHunk(hunk);
      } catch (error) {
        // One failed hunk must not sink the whole review.
        const reason = error instanceof Error ? error.message : "unknown error";
        this.logger.warn(`diff review hunk failed for ${hunk.path}: ${reason}`);
        continue;
      }
      inputTokens += review.usage.inputTokens;
      outputTokens += review.usage.outputTokens;
      const summary = review.result.summary.trim();
      if (summary) summaries.push(`**${hunk.path}** — ${summary}`);
      for (const comment of review.result.comments) {
        if (comments.length >= MAX_REVIEW_COMMENTS) break;
        // The LLM counts positions from its own hunk's @@ header; GitHub
        // counts from the file's FIRST @@ header — shift by positionBase.
        const target = hunk.lines[comment.position - 1];
        // Scope guard: only added lines ("+") are commentable. Context,
        // deletions and hallucinated offsets are dropped so GitHub never
        // 422s the entire review over one bad comment.
        if (!target || !target.startsWith("+")) continue;
        comments.push({
          path: hunk.path,
          position: hunk.positionBase + comment.position,
          body: comment.body,
        });
      }
    }
    const costUsd =
      (inputTokens / 1_000_000) * INPUT_TOKEN_USD_PER_M +
      (outputTokens / 1_000_000) * OUTPUT_TOKEN_USD_PER_M;

    // Same llm_calls ledger the CLI fills via `sft sync` — without this the
    // Economic Layer card shows $0.00 for hosted reviews. Written before the
    // no-findings early return and before the GitHub call so a review we
    // already paid for is never left unbilled, and best-effort so a DB hiccup
    // can never lose the review itself.
    this.logger.log(
      `Attempting to insert llm_calls with costUsd=${costUsd}, tokens=${inputTokens}/${outputTokens}`,
    );
    try {
      await this.db.insert(llmCalls).values({
        userId: project.userId,
        // Ties the review cost to the background PR run enqueued above.
        ...(runId !== undefined ? { runId } : {}),
        // "openai-compatible" (not "openrouter"): the provider value must stay
        // inside LlmProviderId in packages/schemas/src/llm.ts — the shared
        // source of truth — even though llm_calls.provider is free text.
        provider: "openai-compatible",
        model: this.config.env.LLM_REVIEW_MODEL,
        mode: "explain",
        inputTokens,
        outputTokens,
        // numeric(12,6) is typed as string by drizzle (see UsageService).
        totalCostUsd: String(costUsd),
        durationMs: Date.now() - reviewStartedAt,
        category: "Code Review",
        ruleId: "pr-diff-review",
      });
    } catch (error) {
      this.logger.error(
        `FAILED TO SAVE LLM CALLS TO DB: ${error instanceof Error ? error.stack : String(error)}`,
      );
      const reason = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(
        `could not persist review usage for ${repository.full_name}#${prNumber}: ${reason}`,
      );
    }

    if (summaries.length === 0 && comments.length === 0) {
      return { status: "no-findings", ...(runId !== undefined ? { runId } : {}) };
    }

    const summaryBlock = summaries.length > 0 ? summaries.join("\n\n") : "Inline comments below.";

    const receipt =
      `Cost of this review: ${formatUsd(costUsd)} · ` +
      `Estimated tokens saved: ${TOKENS_SAVED_ESTIMATE.toLocaleString("en-US")}`;
    await this.github.createPullRequestReview(
      installation.id,
      owner,
      repo,
      prNumber,
      commitSha,
      `## Cicured AI review\n\n${summaryBlock}\n\n---\n*${receipt}*`,
      comments,
    );
    return { status: "review-posted", ...(runId !== undefined ? { runId } : {}) };
  }

  /**
   * Insert + enqueue the background `pr`-triggered run for this PR head.
   * Returns undefined when a queued/running run for the same sha already
   * exists (the push handler's dedup posture, reused so a redelivered event
   * never doubles a sandbox).
   */
  private async enqueuePullRequestRun(
    projectId: string,
    sha: string,
    branch: string,
    prNumber: number,
  ): Promise<string | undefined> {
    const [existing] = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(
        and(
          eq(runs.projectId, projectId),
          eq(runs.sha, sha),
          inArray(runs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (existing) return undefined;

    const [run] = await this.db
      .insert(runs)
      .values({ projectId, sha, branch, trigger: "pr", status: "queued" })
      .returning({ id: runs.id });
    if (!run) throw new Error("run insert returned no row");

    await this.queue.enqueueRun({ runId: run.id, projectId, prNumber });
    return run.id;
  }
}

/** Postgres unique_violation; anything else is a real failure. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Mirrors apps/web/lib/format.ts `formatUsd` so the GitHub cost receipt uses
 * the same rounding the dashboard does: `$0.00` for no spend, four decimals
 * under $1, two from $1 up.
 */
function formatUsd(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 1) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}