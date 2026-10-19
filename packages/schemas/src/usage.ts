import { z } from "zod";

/** One row of the dashboard card's "top models by spend" list. */
export const TopModelUsage = z.object({
  model: z.string().min(1),
  calls: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type TopModelUsage = z.infer<typeof TopModelUsage>;

/** GET /usage/summary response: the caller's LLM usage totals so far. */
export const UsageSummary = z.object({
  totalCalls: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  topModels: z.array(TopModelUsage),
});
export type UsageSummary = z.infer<typeof UsageSummary>;
