/**
 * Zero-result discovery (UX #7; D-088) for routes. Kept out of container.ts
 * (Lead-owned, D-014): the pieces here are built lazily, once per process, on `globalThis`.
 *
 * - "Sounds like this": Last.fm `artist.getSimilar` through the shared Last.fm client rules
 *   (paced, validated, 7-day cache), then our own catalogue. Answers are cached 10 minutes per
 *   artist, and each client is rate limited (Postgres, D-070) before any Last.fm call.
 */
import { SearchPageParamsSchema } from "@/application/events";
import { similarShows, type SimilarShows } from "@/application/events/similar-shows";
import type { RateLimiter } from "@/application/ports/engagement";
import { PgRateLimiter } from "@/infrastructure/db/pg-rate-limiter";
import { InMemoryRateLimiter } from "@/infrastructure/in-memory-rate-limiter";
import { LastfmSimilarArtists } from "@/infrastructure/music-signals/lastfm-similar";
import { TtlCache } from "@/infrastructure/music-signals/ttl-cache";
import { env } from "@/lib/env";
import { RateLimitedError } from "@/lib/errors";
import { container } from "@/server/container";
import { events } from "@/server/events";

const ANSWER_TTL_MS = 10 * 60_000;
/** Per client: a zero-result page asks once; this leaves room for a burst of typing. */
const CLIENT_LIMIT = { limit: 20, windowMs: 60_000 };

type Discovery = {
  similar: LastfmSimilarArtists | null;
  answers: TtlCache<SimilarShows>;
  limiter: RateLimiter;
};

function build(): Discovery {
  const c = container();
  const e = env();
  const secret = e.SESSION_SECRET;
  return {
    similar: e.LASTFM_API_KEY
      ? new LastfmSimilarArtists({
          apiKey: e.LASTFM_API_KEY,
          fetch: (input, init) => fetch(input, init),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          clock: c.clock,
        })
      : null,
    answers: new TtlCache(c.clock, ANSWER_TTL_MS, 500),
    // D-070: shared across instances when the HMAC secret is configured (always on Vercel).
    limiter: secret
      ? new PgRateLimiter(c.db, { name: "similar:client", ...CLIENT_LIMIT, keySecret: secret })
      : new InMemoryRateLimiter(CLIENT_LIMIT.limit, CLIENT_LIMIT.windowMs),
  };
}

const holder = globalThis as typeof globalThis & { __tixtapeDiscovery?: Discovery };
const discovery = () => (holder.__tixtapeDiscovery ??= build());

/** Upcoming shows by artists like `artist`. Throws `RateLimitedError` (429) for a busy client. */
export async function similarShowsFor(artist: string, clientKey: string): Promise<SimilarShows> {
  const d = discovery();
  const c = container();
  const key = artist.trim().toLowerCase();
  const cached = d.answers.get(key);
  if (cached) return cached;
  if (!(await d.limiter.take(clientKey, c.clock.now()))) {
    throw new RateLimitedError("Too many lookups. Try again in a minute.", 60);
  }
  if (!d.similar) return { artists: [], shows: [] };
  const answer = await similarShows(
    {
      similar: d.similar,
      showsBy: async (name, limit) =>
        (
          await events().searchPage(
            SearchPageParamsSchema.parse({
              artist: name,
              from: c.clock.now().toISOString(),
              pageSize: String(limit),
            }),
          )
        ).results,
      logger: c.logger,
    },
    artist.trim(),
  );
  d.answers.set(key, answer);
  return answer;
}
