/**
 * Free doubt resolver ports (D-062, D-064). Implemented in src/infrastructure/ai/.
 * Neither is ever a source of facts: pages are sources; the extractor only reads them.
 */
import { AppError } from "@/lib/errors";

export type WebPage = {
  url: string;
  title: string;
  /** The page text the search service fetched (quotes are checked against this). */
  content: string;
};

export interface WebSearch {
  search(
    query: string,
    opts: { maxResults: number; excludeDomains: readonly string[] },
  ): Promise<WebPage[]>;
}

export type ExtractionRequest = {
  /** What we're trying to confirm, to focus the reading; never treated as a fact. */
  event: { title: string; city: string; date: string };
  page: WebPage;
};

export interface GroundedExtractor {
  /** The model's JSON reply (unvalidated: callers ground it against the page text). */
  extract(request: ExtractionRequest): Promise<unknown>;
}

/** Rate limit or quota reached (HTTP 429, quota errors): skip AI work for now, don't fail. */
export class AiUnavailableError extends AppError {
  readonly code = "ai_unavailable";
  override readonly httpStatus = 503;
  constructor(
    readonly service: string,
    message: string,
  ) {
    super(message);
  }
}
