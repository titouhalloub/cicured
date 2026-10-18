import type { LlmProviderId } from "@cicured/schemas";
import type { LlmProvider, LlmRequest, LlmResponse, ProviderConfig } from "./types";
import { buildMessages } from "./prompt";
import { lookupPricing, computeCostUsd } from "./pricing";

function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return "https://api.openai.com/v1";
  // Don't double /v1 if already present
  if (baseUrl.endsWith("/v1")) return baseUrl;
  return baseUrl.replace(/\/$/, "") + "/v1";
}

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

interface OpenAiChoice {
  message: {
    content: string | null;
  };
}

interface OpenAiResponse {
  choices: OpenAiChoice[];
  usage?: OpenAiUsage;
  model?: string;
}

export class OpenAiCompatProvider implements LlmProvider {
  readonly providerId: LlmProviderId;
  readonly model: string;
  readonly pricing: import("@cicured/schemas").ModelPricing;
  readonly baseUrl: string;
  readonly apiKey: string;

  constructor(cfg: ProviderConfig) {
    this.providerId = cfg.provider as LlmProviderId;
    this.model = cfg.model;
    this.pricing = cfg.pricing;
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl);
    this.apiKey = cfg.apiKey;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const start = Date.now();
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`openai-compat request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const payload: unknown = await response.json();
    const parsed = payload as OpenAiResponse;
    const choice = parsed.choices?.[0];
    const text = choice?.message?.content ?? "";

    const usage = parsed.usage;
    const reportedUsage = {
      inputTokens: usage?.prompt_tokens ?? Math.ceil(text.length / 4),
      outputTokens: usage?.completion_tokens ?? Math.ceil(text.length / 4),
      cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheCreationTokens: 0,
      source: usage ? "reported" as const : "estimated" as const,
    };

    return {
      text,
      usage: reportedUsage,
      model: parsed.model ?? this.model,
      provider: this.providerId,
      endpoint: url,
      durationMs: Date.now() - start,
    };
  }
}