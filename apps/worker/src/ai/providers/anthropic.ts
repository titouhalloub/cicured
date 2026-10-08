import type { LlmMessage, LlmResponse, LlmProvider } from "../provider";

const TIMEOUT_MS = 60_000;

/**
 * Real Anthropic Messages API adapter.
 *
 * Uses Node's built-in fetch (Node 18+). The model name and API key come from
 * the caller, never from this file.
 */
export function createAnthropicProvider(apiKey: string, model: string): LlmProvider {
  return {
    name: "anthropic",
    model,
    complete: async (msg: LlmMessage): Promise<LlmResponse> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: msg.maxOutputTokens,
            temperature: msg.temperature,
            system: msg.system,
            messages: [{ role: "user", content: msg.user }],
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.clone().text();
          throw new Error(
            `HTTP ${response.status}: ${body.length > 300 ? body.substring(0, 300) + "..." : body}`,
          );
        }

        const data: unknown = await response.json();
        const content = (data as { content?: Array<{ text?: unknown }>}).content;
        const contentBlock = content?.[0];
        const text = typeof contentBlock?.text === "string" ? contentBlock.text : "";
        const usage = (data as { usage?: Record<string, unknown> }).usage || {};
        return {
          text,
          promptTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
          completionTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
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
