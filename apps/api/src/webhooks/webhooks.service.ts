import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { GithubPushPayloadSchema } from "@sft/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { CryptoService } from "../common/crypto.service";
import { AppConfig } from "../config/app-config.service";
import { DRIZZLE, projects, runs, webhookDeliveries, type Database } from "../db";
import { RunsQueue } from "../queue/runs-queue.service";

/**
 * GitHub push webhooks (Spec §0 push trigger; M2b-2c): verify the HMAC,
 * dedupe deliveries, and fan a push event into a queued run.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly config: AppConfig,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crypto: CryptoService,
    private readonly queue: RunsQueue,
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