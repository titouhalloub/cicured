import { Inject, Injectable } from "@nestjs/common";
import { UUID_PATTERN, UsageSummary, type LlmCallRecord } from "@sft/schemas";
import { and, count, desc, eq, inArray, isNotNull, sql, sum } from "drizzle-orm";
import { DRIZZLE, llmCalls, projects, runs, type Database, type UserRow } from "../db";

/** One row of the dashboard "Bugs Fixed by Type" breakdown table. */
export interface BreakdownRow {
  category: string;
  ruleId: string;
  bugCount: number;
  totalCostUsd: number;
}

/** How many models the cost dashboard card ranks by spend. */
const TOP_MODELS_LIMIT = 5;

/** Ledger record as uploaded by the CLI — runId is optional and advisory. */
export type SyncLlmCall = LlmCallRecord & { runId?: string };

/** Row shape handed to drizzle's insert (totalCostUsd is a numeric column). */
interface LlmCallInsert {
  userId: string;
  runId: string | null;
  provider: string;
  model: string;
  mode: string;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: string;
  durationMs: number;
  ruleId: string | null;
  category: string | null;
  estimatedTokensAvoided: number | null;
  findingId: string | null;
}

/**
 * Stores CLI-uploaded LLM usage rows (`sft sync`). One insert per batch — a
 * malformed batch is rejected upstream by the zod pipe, never here.
 */
@Injectable()
export class UsageService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async insertLlmCalls(user: UserRow, records: SyncLlmCall[]): Promise<{ inserted: number }> {
    if (records.length === 0) return { inserted: 0 };

    const resolvableRunIds = await this.resolveRunIds(user.id, records);

    const values: LlmCallInsert[] = records.map((record) => ({
      userId: user.id,
      runId: record.runId && resolvableRunIds.has(record.runId) ? record.runId : null,
      provider: record.provider,
      model: record.model,
      mode: record.mode,
      inputTokens: record.usage.inputTokens,
      outputTokens: record.usage.outputTokens,
      totalCostUsd: String(record.totalCostUsd),
      durationMs: record.durationMs,
      // Nullable columns: ledgers recorded before enrichment carry nothing here.
      ruleId: record.ruleId ?? null,
      category: record.category ?? null,
      estimatedTokensAvoided: record.estimatedTokensAvoided ?? null,
      // sha256 fingerprint, joined to findings.fingerprint on the run detail page.
      findingId: record.findingId ?? null,
    }));

    await this.db.insert(llmCalls).values(values);
    return { inserted: records.length };
  }

  /**
   * Aggregates the caller's ledger for the Economic Layer dashboard card:
   * spend totals, tokens avoided (→ savings/ROI at $15/M), top models by
   * spend, and spend by finding category. Postgres returns sum() as a string
   * (and null for an empty set), so values are coerced before the shared
   * schema gets the final say.
   */
  async getSummary(user: UserRow): Promise<UsageSummary & { breakdown: BreakdownRow[] }> {
    const [totals] = await this.db
      .select({
        totalCalls: count(),
        totalCostUsd: sum(llmCalls.totalCostUsd),
        tokensAvoided: sum(llmCalls.estimatedTokensAvoided),
      })
      .from(llmCalls)
      .where(eq(llmCalls.userId, user.id));

    const topModels = await this.db
      .select({ model: llmCalls.model, calls: count(), costUsd: sum(llmCalls.totalCostUsd) })
      .from(llmCalls)
      .where(eq(llmCalls.userId, user.id))
      .groupBy(llmCalls.model)
      .orderBy(desc(sql`sum(${llmCalls.totalCostUsd})`))
      .limit(TOP_MODELS_LIMIT);

    const byCategory = await this.db
      .select({ category: llmCalls.category, calls: count(), costUsd: sum(llmCalls.totalCostUsd) })
      .from(llmCalls)
      .where(and(eq(llmCalls.userId, user.id), isNotNull(llmCalls.category)))
      .groupBy(llmCalls.category);

    const breakdown = await this.db
      .select({
        category: llmCalls.category,
        ruleId: llmCalls.ruleId,
        bugCount: count(),
        totalCostUsd: sum(llmCalls.totalCostUsd),
      })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.userId, user.id),
          isNotNull(llmCalls.category),
          isNotNull(llmCalls.ruleId),
        ),
      )
      .groupBy(llmCalls.category, llmCalls.ruleId)
      .orderBy(desc(sql`sum(${llmCalls.totalCostUsd})`));

    const totalCostUsd = toUsdNumber(totals?.totalCostUsd);
    const totalTokensAvoided = Number(totals?.tokensAvoided ?? 0);
    const totalEstimatedSavingsUsd = (totalTokensAvoided / 1_000_000) * 15.0;
    const netRoi = totalCostUsd > 0 ? totalEstimatedSavingsUsd / totalCostUsd : 0;

    const summary = UsageSummary.parse({
      totalCalls: totals?.totalCalls ?? 0,
      totalCostUsd,
      totalTokensAvoided,
      totalEstimatedSavingsUsd,
      netRoi,
      byCategory: byCategory.map((row) => ({
        category: row.category ?? "",
        calls: row.calls,
        costUsd: toUsdNumber(row.costUsd),
      })),
      topModels: topModels.map((row) => ({
        model: row.model,
        calls: row.calls,
        costUsd: toUsdNumber(row.costUsd),
      })),
    });

    return {
      ...summary,
      breakdown: breakdown.map((row) => ({
        category: row.category ?? "",
        ruleId: row.ruleId ?? "",
        bugCount: Number(row.bugCount),
        totalCostUsd: toUsdNumber(row.totalCostUsd),
      })),
    };
  }

  /**
   * runId is advisory: only uuid-shaped ids that resolve to a run owned by the
   * user are stored; anything else becomes NULL so one missing/placeholder run
   * never fails the whole batch. The FK on llm_calls.run_id would reject a
   * dangling id, hence this lookup before insert.
   */
  private async resolveRunIds(userId: string, records: SyncLlmCall[]): Promise<Set<string>> {
    const candidates = [
      ...new Set(
        records
          .map((record) => record.runId)
          .filter((runId): runId is string => typeof runId === "string" && UUID_PATTERN.test(runId)),
      ),
    ];
    if (candidates.length === 0) return new Set();

    const rows = await this.db
      .select({ id: runs.id })
      .from(runs)
      .innerJoin(projects, eq(projects.id, runs.projectId))
      .where(and(eq(projects.userId, userId), inArray(runs.id, candidates)));
    return new Set(rows.map((row) => row.id));
  }
}

/** sum(numeric) arrives as a string; null/undefined means "no rows". */
function toUsdNumber(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}