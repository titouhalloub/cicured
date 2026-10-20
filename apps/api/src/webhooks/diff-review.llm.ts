import { BadGatewayException, Injectable } from "@nestjs/common";
import type { DiffHunk } from "@sft/parser";
import { PrReviewResult } from "@sft/schemas";
import { AppConfig } from "../config/app-config.service";

/** Lines of one hunk shown to the model; positions beyond them are unreachable. */
const MAX_HUNK_LINES = 160;
const TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 1500;

const SYSTEM_PROMPT =
  "You are Cicured, an expert code reviewer. You review ONLY the changed lines " +
  "of a pull request diff hunk. Respond with raw JSON only: no markdown " +
  "fences, no prose before or after the JSON object.";

/** One hunk's review plus the token usage OpenRouter billed for it — feeds the cost receipt footer. */
export interface HunkReview {
  result: PrReviewResult;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * OpenRouter (OpenAI-compatible) chat client for the diff-scoped PR reviewer.
 * Feature-gated on OPENROUTER_API_KEY: `enabled` false disables PR reviews
 * without failing boot.
 */
@Injectable()
export class DiffReviewLlm {
  constructor(private readonly config: AppConfig) {}

  get enabled(): boolean {
    return Boolean(this.config.env.OPENROUTER_API_KEY);
  }

  /**
   * Reviews one hunk and validates the model's JSON against PrReviewResult.
   * The billed token usage travels with the result so the webhook can print
   * a cost receipt footer. Throws on transport errors, HTTP errors or
   * unparseable output — callers treat a failed hunk as skippable, never
   * fatal for the whole review.
   */
  async reviewHunk(hunk: DiffHunk): Promise<HunkReview> {
    const apiKey = this.config.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new BadGatewayException("OPENROUTER_API_KEY is not configured");

    let response: Response;
    try {
      response = await fetch(`${this.config.env.LLM_API_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.env.LLM_REVIEW_MODEL,
          temperature: 0.1,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildHunkPrompt(hunk) },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network error";
      throw new BadGatewayException(`OpenRouter request failed: ${reason}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BadGatewayException(
        `OpenRouter responded ${response.status}: ${text.slice(0, 200)}`,
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      result: PrReviewResult.parse(
        extractReviewJson(payload.choices?.[0]?.message?.content ?? ""),
      ),
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** The user message for one hunk, with the position contract spelled out. */
export function buildHunkPrompt(hunk: DiffHunk): string {
  const lines = hunk.lines.slice(0, MAX_HUNK_LINES);
  return [
    `File: ${hunk.path}`,
    `Hunk: ${hunk.header}`,
    "",
    ...lines,
    "",
    "You are a code reviewer. Review the following diff hunk. Find bugs,",
    "security issues, or style violations.",
    "Return JSON matching { summary: string, comments: [{ path: string, position: number, body: string }] }.",
    "IMPORTANT: Only report issues on lines that actually changed (lines starting with +).",
    'The "position" is the offset from this hunk\'s @@ header: 1 for the first',
    "line after the header, 2 for the second, and so on — count every line",
    `shown above, including removed (-) lines. The "path" must be exactly "${hunk.path}".`,
  ].join("\n");
}

/**
 * The model sometimes wraps JSON in ``` fences or surrounding prose; strip
 * both and keep the outermost {...} so PrReviewResult.parse gets an object.
 */
function extractReviewJson(content: string): unknown {
  const unfenced = content.replace(/```(?:json)?/g, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("LLM review response contained no JSON object");
  }
  return JSON.parse(unfenced.slice(start, end + 1));
}