/**
 * Live lookup and the watch list (D-050, D-070) for routes and jobs. The lookup is built by
 * the container; each request does its own bounded work and answers are shared through the
 * Postgres cache (`PgLookupCache`), never through in-memory jobs.
 */
import type { LiveLookup } from "@/application/ingestion/live-lookup";
import { foldText } from "@/domain/events/text";
import { container } from "@/server/container";
import { events } from "@/server/events";

/** Zero-result searches from the last two weeks, most frequent first. */
const WATCH_WINDOW_MS = 14 * 86_400_000;
const WATCH_LIMIT = 10;

export function lookup(): LiveLookup {
  return container().lookup;
}

/** The watch list: recent zero-result searches (D-050), derived from `search_log`. */
export async function watchTerms(): Promise<string[]> {
  const since = new Date(container().clock.now().getTime() - WATCH_WINDOW_MS);
  const rows = await events().listZeroResultQueries(since, WATCH_LIMIT * 2);
  const terms = rows.map((r) => foldText(r.query)).filter((t) => t.length >= 2 && t.length <= 100);
  return [...new Set(terms)].slice(0, WATCH_LIMIT);
}
