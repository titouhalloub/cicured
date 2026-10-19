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
