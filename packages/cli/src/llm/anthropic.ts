import type { LlmProviderId } from "@cicured/schemas";
import { z } from "zod";
import type { LlmProvider, LlmRequest, LlmResponse, ProviderConfig } from "./types";
import { buildMessages, type SuggestInput, validateFilesTouched } from "./prompt";
import { lookupPricing, computeCostUsd } from "./pricing";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface AnthropicResponse {
  content: AnthropicTextBlock[];
  usage?: AnthropicUsage;
  model?: string;
}

function extractText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const content = (payload as { content?: unknown }).content;
  if (!Array.isArray(content)) return null;
  for (const block of content as AnthropicTextBlock[]) {
    if (typeof block === "object" && block !== null && block.type === "text") {
      return typeof block.text === "string" ? block.text : null;
    }
  }
  return null;
}

/** Models occasionally wrap JSON in a ```json fence despite the prompt. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return match?.[1]?.trim() ?? trimmed;
}

const LlmSuggestionSchema = z.object({
  patchDiff: z.string().min(1),
  explanation: z.string().min(1),
  confidence: z.number().min(0).max(1),
  filesTouched: z.array(z.string().min(1)).min(1),
});

export class AnthropicProvider implements LlmProvider {
  readonly providerId: LlmProviderId = "anthropic";
  readonly model: string;
  readonly pricing: import("@cicured/schemas").ModelPricing;

  constructor(private cfg: ProviderConfig) {
    this.model = cfg.model;
    this.pricing = cfg.pricing;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const start = Date.now();
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": this.cfg.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`anthropic request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const payload: unknown = await response.json();
    const text = extractText(payload);
    if (text === null) {
      throw new Error("anthropic response contained no text block");
    }

    const usage = (payload as AnthropicResponse).usage;
    const reportedUsage = {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
      source: usage ? "reported" as const : "estimated" as const,
    };

    return {
      text,
      usage: reportedUsage,
      model: this.model,
      provider: "anthropic",
      endpoint: API_URL,
      durationMs: Date.now() - start,
    };
  }
}

export async function callAnthropic(
  cfg: ProviderConfig,
  req: LlmRequest,
): Promise<LlmResponse> {
  const provider = new AnthropicProvider(cfg);
  return provider.complete(req);
}

export async function suggestFix(
  provider: AnthropicProvider,
  input: SuggestInput,
): Promise<{
  patchDiff: string;
  explanation: string;
  confidence: number;
  filesTouched: string[];
}> {
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
    throw new Error("anthropic did not return valid JSON");
  }

  const parsed = LlmSuggestionSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? issue.path.join(".") : "<root>";
    throw new Error(`anthropic JSON did not match the expected shape (${where}: ${issue?.message ?? "invalid"})`);
  }

  validateFilesTouched(parsed.data.filesTouched, input);
  return parsed.data;
}

export async function explainFinding(
  provider: AnthropicProvider,
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