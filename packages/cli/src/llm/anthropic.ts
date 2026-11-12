import type { LlmProviderId } from "@sft/schemas";
import type { LlmProvider, LlmRequest, LlmResponse, ProviderConfig } from "./types";
import type { ModelPricing } from "@sft/schemas";

const API_URL = "https://api.anthropic.com/v1/messages";
export class AnthropicProvider implements LlmProvider {
  readonly providerId: LlmProviderId = "anthropic";
  readonly model: string;
  readonly pricing: ModelPricing;

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


