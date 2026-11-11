import type { LlmMessage, LlmResponse, LlmProvider } from "../provider";

const TIMEOUT_MS = 60_000;
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

/** OpenAI-compatible OpenRouter chat-completions adapter. */
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
            messages: [
              { role: "system", content: msg.system },
              { role: "user", content: msg.user },
            ],
            max_tokens: msg.maxOutputTokens,
            temperature: msg.temperature,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `HTTP ${response.status}: ${body.length > 300 ? body.substring(0, 300) + "..." : body}`,
          );
        }

        const data: unknown = await response.json();
        const payload = data as {
          choices?: Array<{ message?: { content?: unknown } }>;
          usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
        };
        const content = payload.choices?.[0]?.message?.content;
        const text = typeof content === "string" ? content : "";
        const usage = payload.usage ?? {};
        return {
          text,
          promptTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
          completionTokens:
            typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
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
