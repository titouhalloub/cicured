import { z } from "zod";

export const CodeGraphFunction = z.object({
  name: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().nonnegative(),
  callsTo: z.array(z.string()),
  calledBy: z.array(z.string()),
  referencedIn: z.array(z.string()),
});
export type CodeGraphFunction = z.infer<typeof CodeGraphFunction>;

export const CodeGraphFile = z.object({
  path: z.string().min(1),
  imports: z.array(z.string()),
  importedBy: z.array(z.string()),
  functions: z.array(CodeGraphFunction),
  tests: z.array(z.string()),
});
export type CodeGraphFile = z.infer<typeof CodeGraphFile>;

export const CodeGraphWarning = z.object({
  path: z.string(),
  reason: z.string(),
});
export type CodeGraphWarning = z.infer<typeof CodeGraphWarning>;

export const CodeGraph = z.object({
  version: z.literal(1),
  repoRoot: z.string(),
  gitSha: z.string().nullable(),
  builtAt: z.string().datetime(),
  files: z.array(CodeGraphFile),
  warnings: z.array(CodeGraphWarning),
});
export type CodeGraph = z.infer<typeof CodeGraph>;
