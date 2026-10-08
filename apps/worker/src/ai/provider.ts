import type { WorkerEnv } from "../env";
import { createAnthropicProvider } from "./providers/anthropic";

export interface LlmMessage {
  system: string;
  user: string;
  maxOutputTokens: number;
  temperature: number;
}

export interface LlmResponse {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(msg: LlmMessage): Promise<LlmResponse>;
}

/**
 * Instantiate the configured provider.
 *
 * `ANTHROPIC_API_KEY` is required and is only ever read from env (never from
 * code/logs). Returns null when the key or a tie-breaker config is missing, so
 * the caller can skip the suggestion stage without special-casing the error.
 */
export function createLlmProvider(env: WorkerEnv): LlmProvider | null {
  const provider = env.LLM_PROVIDER;
  const model = env.LLM_MODEL;
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!provider || !model) {
    if (!provider) console.error("[sft-worker] LLM_PROVIDER is not set in env");
    if (!model) console.error("[sft-worker] LLM_MODEL is not set in env");
    return null;
  }
  if (provider !== "anthropic") {
    console.error(`[sft-worker] unsupported LLM_PROVIDER "${provider}"`);
    return null;
  }
  if (!apiKey) {
    console.error("[sft-worker] ANTHROPIC_API_KEY is not set");
    return null;
  }
  return createAnthropicProvider(apiKey, model);
}
