import type { WorkerEnv } from "../env";
import { createAnthropicProvider } from "./providers/anthropic";
import { createOpenRouterProvider } from "./providers/openrouter";

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

/** Instantiate the configured provider. Missing selected-provider credentials disable suggestions. */
export function createLlmProvider(env: WorkerEnv): LlmProvider | null {
  const model = env.LLM_MODEL;
  if (!model) {
    console.error("[sft-worker] LLM_MODEL is not set in env");
    return null;
  }

  if (env.LLM_PROVIDER === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      console.error("[sft-worker] ANTHROPIC_API_KEY is not set");
      return null;
    }
    return createAnthropicProvider(env.ANTHROPIC_API_KEY, model);
  }

  if (env.LLM_PROVIDER === "openrouter") {
    if (!env.OPENROUTER_API_KEY) {
      console.error("[sft-worker] OPENROUTER_API_KEY is not set");
      return null;
    }
    return createOpenRouterProvider(env.OPENROUTER_API_KEY, model);
  }

  console.error(`[sft-worker] unsupported LLM_PROVIDER "${env.LLM_PROVIDER}"`);
  return null;
}
