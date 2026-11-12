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

/**
 * Instantiate the selected provider. A missing provider-specific key disables
 * only the optional suggestion stage; it never prevents deterministic reviews.
 */
export function createLlmProvider(env: WorkerEnv): LlmProvider | null {
  const model = env.LLM_MODEL;
  if (!model) {
    console.error("[sft-worker] LLM_MODEL is not set in env");
    return null;
  }

  switch (env.LLM_PROVIDER) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        console.error("[sft-worker] ANTHROPIC_API_KEY is not set");
        return null;
      }
      return createAnthropicProvider(env.ANTHROPIC_API_KEY, model);
    }
    case "openrouter": {
      if (!env.OPENROUTER_API_KEY) {
        console.error("[sft-worker] OPENROUTER_API_KEY is not set");
        return null;
      }
      return createOpenRouterProvider(env.OPENROUTER_API_KEY, model);
    }
    default: {
      const exhaustive: never = env.LLM_PROVIDER;
      console.error(`[sft-worker] unsupported LLM_PROVIDER "${exhaustive}"`);
      return null;
    }
  }
}
