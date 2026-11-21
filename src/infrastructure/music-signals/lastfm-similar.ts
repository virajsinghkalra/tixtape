/**
 * Last.fm `artist.getSimilar` (OD-8, D-088): names that sound like an artist we have no shows
 * for, so a zero-result search can still point somewhere. Reuses the shared `LastfmClient`
 * (paced, validated, timed out) and caches per artist for 7 days. No Spotify calls.
 */
import { z } from "zod";
import type { SimilarArtistSource } from "@/application/ports/similar-artists";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { LastfmClient, type LastfmDeps } from "./lastfm";
import { DAY_MS, TtlCache } from "./ttl-cache";

const SIMILAR_TTL_MS = 7 * DAY_MS;
/** We only check a handful against our lineups; ask for a few spare. */
export const SIMILAR_LIMIT = 15;

const SimilarSchema = z.object({
  name: z.string().trim().min(1),
  match: z.union([z.number(), z.string().transform(Number)]).catch(0),
});
/** Last.fm's JSON turns a one-item list into a bare object. */
const ListSchema = z.union([z.array(SimilarSchema), SimilarSchema.transform((a) => [a])]);
const BodySchema = z.object({
  similarartists: z.object({ artist: ListSchema.default([]) }),
});

/** Most similar first, each name once, never the artist itself. */
export function similarNames(
  artistName: string,
  found: readonly { name: string; match: number }[],
  limit = SIMILAR_LIMIT,
): string[] {
  const self = normalizeArtistName(artistName);
  const seen = new Set<string>([self]);
  const out: string[] = [];
  for (const a of [...found].sort((x, y) => (y.match || 0) - (x.match || 0))) {
    const key = normalizeArtistName(a.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a.name);
    if (out.length >= limit) break;
  }
  return out;
}

export class LastfmSimilarArtists implements SimilarArtistSource {
  private readonly cache: TtlCache<string[]>;

  constructor(
    deps: LastfmDeps,
    private readonly client = new LastfmClient(deps),
  ) {
    this.cache = new TtlCache(deps.clock, SIMILAR_TTL_MS, 1_000);
  }

  similarTo(artistName: string): Promise<string[]> {
    return this.cache.getOrLoad(normalizeArtistName(artistName), async () => {
      const body = await this.client.get(
        { method: "artist.getsimilar", artist: artistName, limit: String(SIMILAR_LIMIT) },
        BodySchema,
      );
      return similarNames(artistName, body?.similarartists.artist ?? []);
    });
  }
}
