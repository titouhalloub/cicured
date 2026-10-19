import { Inject, Injectable } from "@nestjs/common";
import { UUID_PATTERN, UsageSummary, type LlmCallRecord } from "@sft/schemas";
import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import { DRIZZLE, llmCalls, projects, runs, type Database, type UserRow } from "../db";

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
    }));

    await this.db.insert(llmCalls).values(values);
    return { inserted: records.length };
  }

  /**
   * Aggregates the caller's ledger for the cost dashboard card: totals plus the
   * top models by spend. Postgres returns sum(numeric) as a string (and null
   * for an empty set), so values are coerced before the shared schema gets the
   * final say.
   */
  async getSummary(user: UserRow): Promise<UsageSummary> {
    const [totals] = await this.db
      .select({ totalCalls: count(), totalCostUsd: sum(llmCalls.totalCostUsd) })
      .from(llmCalls)
      .where(eq(llmCalls.userId, user.id));

    const topModels = await this.db
      .select({ model: llmCalls.model, calls: count(), costUsd: sum(llmCalls.totalCostUsd) })
      .from(llmCalls)
      .where(eq(llmCalls.userId, user.id))
      .groupBy(llmCalls.model)
      .orderBy(desc(sql`sum(${llmCalls.totalCostUsd})`))
      .limit(TOP_MODELS_LIMIT);

    return UsageSummary.parse({
      totalCalls: totals?.totalCalls ?? 0,
      totalCostUsd: toUsdNumber(totals?.totalCostUsd),
      topModels: topModels.map((row) => ({
        model: row.model,
        calls: row.calls,
        costUsd: toUsdNumber(row.costUsd),
      })),
    });
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