import type { LlmProviderId, LlmUsage, ModelPricing } from "@cicured/schemas";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
}

export interface LlmResponse {
  text: string;
  usage: LlmUsage;
  model: string;
  provider: LlmProviderId;
  endpoint?: string;
  durationMs: number;
}

export interface LlmProvider {
  readonly providerId: LlmProviderId;
  readonly model: string;
  readonly pricing: ModelPricing;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface ProviderConfig {
  provider: LlmProviderId;
  model: string;
  baseUrl?: string;
  apiKey: string;
  pricing: ModelPricing;
}