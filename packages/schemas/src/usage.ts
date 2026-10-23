import { z } from "zod";

/** One row of the dashboard card's "top models by spend" list. */
export const TopModelUsage = z.object({
  model: z.string(),
  calls: z.number(),
  costUsd: z.number(),
});
export type TopModelUsage = z.infer<typeof TopModelUsage>;

/** One row of the "spend by finding category" list. */
export const CategoryUsage = z.object({
  category: z.string(),
  calls: z.number(),
  costUsd: z.number(),
});
export type CategoryUsage = z.infer<typeof CategoryUsage>;

/** GET /usage/summary response: LLM spend plus the economic (cost-avoidance) layer. */
export const UsageSummary = z.object({
  totalCalls: z.number(),
  totalCostUsd: z.number(),
  totalTokensAvoided: z.number(),
  totalEstimatedSavingsUsd: z.number(),
  netRoi: z.number(), // 0 if cost is 0
  byCategory: z.array(CategoryUsage),
  topModels: z.array(TopModelUsage),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

/** One row of "Bugs by type": static findings plus the AI spend booked against the same rule. */
export const RoiBugGroup = z.object({
  category: z.string(),
  ruleId: z.string(),
  bugCount: z.number(),
  aiCost: z.number(), // 0 for purely static findings
});
export type RoiBugGroup = z.infer<typeof RoiBugGroup>;

/** One "Recent Run Receipt". */
export const RoiRunReceipt = z.object({
  runId: z.string(),
  repoFullName: z.string(),
  sha: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  bugCount: z.number(),
  totalCostUsd: z.number(),
  breakdown: z.array(z.object({ category: z.string(), costUsd: z.number() })),
});
export type RoiRunReceipt = z.infer<typeof RoiRunReceipt>;

/** GET /usage/roi-receipt response. */
export const RoiReceipt = z.object({
  totalSpend: z.number(),
  totalCalls: z.number(),
  totalBugsFound: z.number(),
  estimatedTimeSavedHours: z.number(),
  estimatedSavingsUsd: z.number(),
  roiMultiplier: z.number(), // 0 when there is no spend
  bugsByType: z.array(RoiBugGroup),
  recentRuns: z.array(RoiRunReceipt),
});
export type RoiReceipt = z.infer<typeof RoiReceipt>;
