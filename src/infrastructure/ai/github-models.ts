/**
 * GitHub Models grounded extraction (D-064): OpenAI-compatible chat completions at
 * `https://models.github.ai/inference/chat/completions`, Bearer token, model from env
 * (`GITHUB_MODELS_MODEL`, default openai/gpt-5.5). The model reads only the page text we send
 * and must quote every fact; the caller checks the quotes.
 */
import { z } from "zod";
import {
  AiUnavailableError,
  type ExtractionRequest,
  type GroundedExtractor,
} from "@/application/ports/web-search";
import { UpstreamError } from "@/lib/errors";

export const GITHUB_MODELS_URL = "https://models.github.ai/inference/chat/completions";
const TIMEOUT_MS = 60_000;
/** Enough text for a lineup announcement; longer pages are trimmed around the event's name. */
const MAX_TEXT = 12_000;
const MAX_COMPLETION_TOKENS = 4_000;
/** A reply longer than this isn't the small JSON object we asked for. */
const MAX_REPLY_CHARS = 20_000;

const SYSTEM = `You extract facts about ONE music event from the page text the user supplies.
Use only that text. Never use outside knowledge, never guess, never infer a year.
Reply with JSON only:
{"title": string|null, "startDate": "YYYY-MM-DD"|null, "endDate": "YYYY-MM-DD"|null,
 "city": string|null, "venue": string|null, "headliners": string[], "support": string[],
 "quotes": {"title"?: string, "startDate"?: string, "city"?: string, "venue"?: string,
            "headliners"?: string, "support"?: string}}
Rules: every non-null field needs a quote that is an EXACT, contiguous copy of text from the
page (same words and order) and that itself states the fact (the date with its year, the
city, the venue, every listed artist name). Dates only if the text states the year. If the
page is about another event or edition, return nulls and empty lists.`;

const ResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/** The part of a long page around the event's name (where its facts usually are). */
export function relevantText(text: string, title: string): string {
  if (text.length <= MAX_TEXT) return text;
  const words = title
    .toLowerCase()
    .split(/\s+/u)
    .filter((w) => w.length > 3 && !/^\d+$/u.test(w));
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
  const start = Math.max(0, (at.length > 0 ? Math.min(...at) : 0) - 1_000);
  return text.slice(start, start + MAX_TEXT);
}

export class GitHubModelsExtractor implements GroundedExtractor {
  constructor(private readonly deps: { token: string; model: string; fetch: typeof fetch }) {}

  async extract(request: ExtractionRequest): Promise<unknown> {
    const { event, page } = request;
    const user = `Event to look for: ${event.title} (${event.city}, ${event.date}).\nPage: ${page.url}\nTitle: ${page.title}\n\nPage text:\n${relevantText(page.content, event.title)}`;
    let res: Response;
    try {
      res = await this.deps.fetch(GITHUB_MODELS_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.deps.token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: this.deps.model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
          // D-070: bounded output (reasoning plus a small JSON object).
          max_completion_tokens: MAX_COMPLETION_TOKENS,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError("github-models", "GitHub Models could not be reached.", { cause: e });
    }
    if (res.status === 429) {
      throw new AiUnavailableError("github-models", "GitHub Models rate limit reached.");
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (/quota|limit/iu.test(body)) {
        throw new AiUnavailableError("github-models", `GitHub Models quota (HTTP ${res.status}).`);
      }
      throw new UpstreamError("github-models", `GitHub Models returned HTTP ${res.status}.`);
    }
    const parsed = ResponseSchema.safeParse(await res.json().catch(() => undefined));
    const content = parsed.success ? parsed.data.choices[0]!.message.content : null;
    if (!content) throw new UpstreamError("github-models", "GitHub Models returned no content.");
    if (content.length > MAX_REPLY_CHARS) {
      throw new UpstreamError("github-models", "GitHub Models reply was too long.");
    }
    try {
      return JSON.parse(content);
    } catch {
      throw new UpstreamError("github-models", "GitHub Models did not return JSON.");
    }
  }
}
