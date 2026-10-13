import { SuggestionDraft, type SuggestionDraft as SuggestionDraftType } from "@sft/schemas";
import type { FindingsWithFingerprint, Neighborhood } from "@sft/parser";
import type { WorkerLogger } from "../common/secrets";
import { buildNeighborhoodBlock, buildSuggestionPrompt, CONTEXT_CHAR_BUDGET } from "./context";
import { computeCacheKey } from "./cache";
import type { LlmMessage, LlmProvider, LlmResponse } from "./provider";
import type { LlmCache } from "./cache";
import { redactSecrets } from "./secret-filter";

const TRAILING_LINES = 20;
/** Locked prompt version; part of the LLM cache key (Spec §7). */
const PROMPT_VERSION = "m4a-v1";
/** Spec §7 guardrails: a finding with >= this many secret-shaped matches is skipped. */
const SKIP_REDACTION_THRESHOLD = 4;

/** Truncate snippet to fit the remaining char budget, keeping the finding region. */
function truncateSnippet(snippet: string, findingLength: number): string {
  const maxSnippetChars = Math.max(0, CONTEXT_CHAR_BUDGET - findingLength);
  if (snippet.length <= maxSnippetChars) return snippet;
  const lines = snippet.split("\n");
  const preservedTrailing = lines.slice(-TRAILING_LINES).join("\n");
  return `${snippet.substring(0, maxSnippetChars - preservedTrailing.length)}\n${preservedTrailing}`;
}

export type FindingsWithId = FindingsWithFingerprint & { id: string };

/** A schema-validated suggestion draft, joined back to its source finding. */
export interface GeneratedSuggestion extends SuggestionDraftType {
  findingId: string;
  fingerprint: string;
  model: string;
  promptVersion: string;
}

export interface GenerateSuggestionsOptions {
  provider: LlmProvider;
  cache: LlmCache;
  logger: WorkerLogger;
  temperature: number;
  maxOutputTokens: number;
  findingsPerRunCap: number;
  /** Phase 3c-2: code graph neighborhood per finding, keyed by fingerprint.
   * Absent or null restores the pre-graph behavior exactly. */
  neighborhoods?: ReadonlyMap<string, Neighborhood | null>;
}

/**
 * Phase 3c-2: when a neighborhood is known, every patched file must be the
 * finding's own repo-relative file or a file in the neighborhood — mirroring
 * the CLI check so a wandering model is rejected instead of cached.
 */
function assertFilesTouchedInNeighborhood(
  filesTouched: string[],
  finding: FindingsWithId,
  neighborhood: Neighborhood | null,
): void {
  if (neighborhood === null) return;
  const relFindingFile = finding.file.replace(/^\/workspace\/repo\//, "");
  const allowed = new Set<string>([
    relFindingFile,
    neighborhood.file.path,
    ...neighborhood.callers.map((caller) => caller.file),
    ...neighborhood.callees.map((callee) => callee.file),
  ]);
  for (const file of filesTouched) {
    if (!allowed.has(file)) {
      throw new Error(`filesTouched outside neighborhood: ${file}`);
    }
  }
}

/**
 * M4a deterministic -> AI stage.
 *
 * Each finding is resolved to a snippet, secret-redacted, cache-checked by
 * (model, promptVersion, fingerprint, sha256(snippet)), prompted and
 * schema-validated with `SuggestionDraft`, cached, and returned.
 *
 * Provider errors, parse errors, and secret contamination skip that finding
 * (never the whole run).
 */
export async function generateSuggestions(
  findings: FindingsWithId[],
  snippetFor: (finding: FindingsWithId) => Promise<string>,
  options: GenerateSuggestionsOptions,
): Promise<GeneratedSuggestion[]> {
  const limited = findings.slice(0, options.findingsPerRunCap);
  const results: GeneratedSuggestion[] = [];

  /** Join a validated draft back to its source finding + prompt provenance. */
  const withFinding = (finding: FindingsWithId, draft: SuggestionDraftType): GeneratedSuggestion => ({
    ...draft,
    findingId: finding.id,
    fingerprint: finding.fingerprint,
    model: options.provider.model,
    promptVersion: PROMPT_VERSION,
  });

  for (const finding of limited) {
    try {
      // Phase 3c-2: neighborhood precomputed by run-job from the sandbox's
      // sft-graph.json. Null (or absent) disables the neighborhood block and
      // the filesTouched containment check.
      const neighborhood = options.neighborhoods?.get(finding.fingerprint) ?? null;

      const snippet = await snippetFor(finding);
      if (!snippet) {
        options.logger.info(`No snippet for finding ${finding.id}`);
        continue;
      }

      // 2. Cap the snippet to the context budget (Spec §7 ~8k tokens). The
      // finding itself is never truncated, only the snippet around it.
      const budgetedSnippet = truncateSnippet(snippet, finding.message.length);

      // 3. Redact secrets BEFORE anything reaches the LLM (Spec §7). We redact
      // the finding message and the snippet independently so the prompt can be
      // rebuilt from cleaned content — the raw text never leaves the worker.
      // The combined match count drives the skip decision: >= SKIP_REDACTION_THRESHOLD
      // distinct secret-shaped strings means the finding is too contaminated to send.
      const redactedMessage = redactSecrets(finding.message);
      const redactedSnippet = redactSecrets(budgetedSnippet);
      const totalRedactions =
        redactedMessage.redactionCount + redactedSnippet.redactionCount;
      if (totalRedactions >= SKIP_REDACTION_THRESHOLD) {
        options.logger.info(
          `Suggestion skipped: secret contamination for ${finding.id} (${totalRedactions} matches)`,
        );
        continue;
      }

      // 4. Compute cache key from the pre-LLM inputs (raw snippet, so a cache
      // hit is reused regardless of redaction) and look up.
      const cacheKey = computeCacheKey({
        model: options.provider.model,
        promptVersion: PROMPT_VERSION,
        fingerprint: finding.fingerprint,
        snippet,
      });

      const cached = await options.cache.get(cacheKey);
      if (cached) {
        results.push(withFinding(finding, cached));
        continue;
      }

      // 5. Build prompt from the REDACTED finding + snippet, then call provider.
      const redactedFinding: FindingsWithFingerprint = {
        ...finding,
        message: redactedMessage.cleaned,
      };
      const prompt = buildSuggestionPrompt(redactedFinding, redactedSnippet.cleaned, neighborhood);
      const message: LlmMessage = {
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
      };

      let response: LlmResponse;
      try {
        response = await options.provider.complete(message);
      } catch (err) {
        options.logger.info(`Provider error for ${finding.id}: ${(err as Error).message}`);
        continue;
      }

      // 5. Parse JSON response; retry once on failure.
      let parsed: SuggestionDraftType | null = null;
      let attempts = 0;
      while (attempts < 2) {
        attempts += 1;
        try {
          const rawText = response.text.trim();
          const start = rawText.indexOf("{");
          const end = rawText.lastIndexOf("}");
          if (start < 0 || end <= start) {
            throw new Error("No JSON object found in LLM response");
          }
          const candidate = JSON.parse(rawText.substring(start, end + 1)) as unknown;
          const validated = SuggestionDraft.safeParse(candidate);
          if (!validated.success) {
            throw new Error("Zod validation failed");
          }
          assertFilesTouchedInNeighborhood(validated.data.filesTouched, finding, neighborhood);
          parsed = validated.data;
          break;
        } catch (parseErr) {
          if (attempts === 2) {
            options.logger.info(
              `LLM response parse failed for ${finding.id}: ${(parseErr as Error).message}`,
            );
            continue; // skip this finding
          }

          // Repair retry: ask for corrected JSON.
          try {
            const followupMsg: LlmMessage = {
              system: prompt.system,
              user: `The previous response was not valid JSON. Please respond with a single JSON object matching this schema:
{
  "patchDiff": "<unified diff, 1-10000 chars, must contain --- or +++ or @@>",
  "explanation": "<1-500 char explanation>",
  "confidence": <number between 0.0 and 1.0>,
  "filesTouched": ["<repo-relative path>", ...]
}

filesTouched must list every file the patch modifies, using repo-relative forward-slash paths. Do not list files outside the finding's file or its immediate callers.
${neighborhood === null ? "" : `\n${buildNeighborhoodBlock(neighborhood)}\n`}
Error encountered: ${(parseErr as Error).message}

Attempt again.`,
              maxOutputTokens: options.maxOutputTokens,
              temperature: options.temperature,
            };
            response = await options.provider.complete(followupMsg);
          } catch (retryErr) {
            options.logger.info(
              `Repair retry also failed for ${finding.id}: ${(retryErr as Error).message}`,
            );
            continue;
          }
        }
      }

      if (!parsed) continue;

      // 6. Cache and return.
      await options.cache.set(cacheKey, parsed);
      results.push(withFinding(finding, parsed));
    } catch (err) {
      options.logger.info(`Suggestion generation error for finding ${finding.id}: ${(err as Error).message}`);
      continue;
    }
  }

  return results;
}
