/**
 * Tavily web search (D-064): `POST https://api.tavily.com/search` with a Bearer key.
 * Returns pages with their text; the resolver keeps only allow-listed domains.
 */
import { z } from "zod";
import { AiUnavailableError, type WebPage, type WebSearch } from "@/application/ports/web-search";
import { safeHttpUrl } from "@/domain/events/http-url";
import { UpstreamError } from "@/lib/errors";

export const TAVILY_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 20_000;

const ResponseSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().default(""),
      content: z.string().default(""),
      raw_content: z.string().nullish(),
    }),
  ),
});

export class TavilySearch implements WebSearch {
  constructor(private readonly deps: { apiKey: string; fetch: typeof fetch }) {}

  async search(
    query: string,
    opts: {
      maxResults: number;
      excludeDomains: readonly string[];
      topic?: "news";
      includeDomains?: readonly string[];
      days?: number;
    },
  ): Promise<WebPage[]> {
    let res: Response;
    try {
      res = await this.deps.fetch(TAVILY_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.deps.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query,
          max_results: opts.maxResults,
          search_depth: "advanced",
          include_raw_content: true,
          exclude_domains: opts.excludeDomains,
          ...(opts.topic ? { topic: opts.topic } : {}),
          ...(opts.includeDomains ? { include_domains: opts.includeDomains } : {}),
          ...(opts.days ? { days: opts.days } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError("tavily", "Tavily could not be reached.", { cause: e });
    }
    if (res.status === 429 || res.status === 432 || res.status === 433) {
      throw new AiUnavailableError("tavily", `Tavily limit reached (HTTP ${res.status}).`);
    }
    if (!res.ok) throw new UpstreamError("tavily", `Tavily returned HTTP ${res.status}.`);
    const parsed = ResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) throw new UpstreamError("tavily", "Tavily returned an unexpected shape.");
    return parsed.data.results.flatMap((r) => {
      const url = safeHttpUrl(r.url);
      const content = r.raw_content?.trim() || r.content;
      return url && content ? [{ url, title: r.title, content }] : [];
    });
  }
}
