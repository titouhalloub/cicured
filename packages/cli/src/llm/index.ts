import type { LlmProvider, ProviderConfig } from "./types";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic";
import { OpenAiCompatProvider } from "./openai-compat";
import { detectProvider } from "./detect";
import { buildMessages, type SuggestInput , validateFilesTouched} from "./prompt";
import { lookupPricing, computeCostUsd, DEFAULT_PRICING } from "./pricing";

export { detectProvider, buildMessages };
export type { LlmProvider, LlmRequest, LlmResponse, ProviderConfig } from "./types";
export type { SuggestInput } from "./prompt";
export { lookupPricing, computeCostUsd, DEFAULT_PRICING } from "./pricing";

export function createProvider(cfg?: ProviderConfig): LlmProvider {
  const resolved = cfg ?? detectProvider();
  switch (resolved.provider) {
    case "anthropic":
      return new AnthropicProvider(resolved);
    case "openai":
    case "openai-compatible":
    case "gemini":
    case "ollama":
      return new OpenAiCompatProvider(resolved);
    default: {
      const exhaustive: never = resolved.provider;
      throw new Error(`Unknown provider: ${exhaustive}`);
    }
  }
}

/** A validated model suggestion — the shape the CLI prints and applies. */
export interface LlmSuggestion {
  patchDiff: string;
  explanation: string;
  confidence: number;
  filesTouched: string[];
}

const LlmSuggestionSchema = z.object({
  patchDiff: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  filesTouched: z.array(z.string().min(1)).min(1),
});

/** Models occasionally wrap JSON in a ```json fence despite the prompt. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

export async function suggestFix(
  provider: LlmProvider,
  input: SuggestInput,
): Promise<LlmSuggestion> {
  const { system, user } = buildMessages(input, "suggest");
  const response = await provider.complete({
    system,
    user,
    maxTokens: 2000,
    temperature: 0.2,
  });

  const text = stripFences(response.text);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("LLM did not return valid JSON");
  }

  const parsed = LlmSuggestionSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    throw new Error(`LLM JSON did not match the expected shape (${where}: ${issue?.message ?? "invalid"})`);
  }

  validateFilesTouched(parsed.data.filesTouched, input);
  return parsed.data;
}

export async function explainFinding(
  provider: LlmProvider,
  input: SuggestInput,
): Promise<string> {
  const { system, user } = buildMessages(input, "explain");
  const response = await provider.complete({
    system,
    user,
    maxTokens: 800,
    temperature: 0.2,
  });
  return response.text;
}