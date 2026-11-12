import type { LlmMessage, LlmResponse, LlmProvider } from "../provider";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 60_000;

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
}

/** OpenAI-compatible OpenRouter Chat Completions adapter using Node fetch. */
export function createOpenRouterProvider(apiKey: string, model: string): LlmProvider {
  return {
    name: "openrouter",
    model,
    complete: async (msg: LlmMessage): Promise<LlmResponse> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: msg.maxOutputTokens,
            temperature: msg.temperature,
            messages: [
              { role: "system", content: msg.system },
              { role: "user", content: msg.user },
            ],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.clone().text();
          throw new Error(
            `HTTP ${response.status}: ${body.length > 300 ? body.substring(0, 300) + "..." : body}`,
          );
        }

        const data = (await response.json()) as OpenRouterResponse;
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string") {
          throw new Error("OpenRouter response did not contain a text message");
        }

        return {
          text: content,
          promptTokens:
            typeof data.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : 0,
          completionTokens:
            typeof data.usage?.completion_tokens === "number" ? data.usage.completion_tokens : 0,
        };
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Request timeout (60s)", { cause: err });
        }
        throw err;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
