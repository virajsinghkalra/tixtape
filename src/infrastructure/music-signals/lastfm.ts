/**
 * Last.fm (D-038, D-065): `artist.getTopTracks` (most listened) and `artist.getInfo`
 * (listeners, for popularity weighting). Free key, non-commercial use: show
 * `LASTFM_ATTRIBUTION` wherever this data is used (the playlist description does).
 * One `LastfmClient` paces both to at most 5 requests per second, with a timeout (D-045).
 */
import { z, type ZodType } from "zod";
import { REQUEST_TIMEOUT_MS } from "@/application/playlists";
import type { Clock } from "@/application/ports/clock";
import type {
  ArtistPopularitySource,
  MostListenedSource,
  MostListenedTrack,
} from "@/application/ports/music-signals";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { UpstreamError } from "@/lib/errors";
import { DAY_MS, TtlCache } from "./ttl-cache";

/** Last.fm's terms require credit and a link. */
export const LASTFM_ATTRIBUTION = "Popularity data from Last.fm (https://www.last.fm)";
export const LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/";

const UPSTREAM = "lastfm";
/** 5 req/s. */
const MIN_REQUEST_INTERVAL_MS = 200;
/** Big-budget artists need deep pools (D-065). */
const TOP_TRACKS_LIMIT = 50;
/** Last.fm error 6: "The artist you supplied could not be found". */
const ARTIST_NOT_FOUND = 6;
/** D-065: popularity changes slowly. */
const POPULARITY_TTL_MS = 7 * DAY_MS;

const count = z.union([z.number(), z.string().regex(/^\d+$/u).transform(Number)]);
const TrackSchema = z.object({
  name: z.string().trim().min(1),
  playcount: count,
  listeners: count,
});
/** Last.fm's JSON turns a one-item list into a bare object. */
const TracksSchema = z.union([z.array(TrackSchema), TrackSchema.transform((t) => [t])]);
const TopTracksSchema = z.object({ toptracks: z.object({ track: TracksSchema.default([]) }) });
const InfoSchema = z.object({ artist: z.object({ stats: z.object({ listeners: count }) }) });
const ErrorSchema = z.object({ error: z.number().int(), message: z.string() });

export type LastfmDeps = {
  apiKey: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
  baseUrl?: string;
  /** D-045: a hung response must not hold up a step. Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
};

/** One paced, validated GET. `null` means Last.fm doesn't know the artist. */
export class LastfmClient {
  private nextRequestAt = 0;

  constructor(private readonly deps: LastfmDeps) {}

  async get<T>(params: Record<string, string>, schema: ZodType<T>): Promise<T | null> {
    const url = new URL(this.deps.baseUrl ?? LASTFM_BASE_URL);
    url.search = new URLSearchParams({
      ...params,
      autocorrect: "1",
      api_key: this.deps.apiKey,
      format: "json",
    }).toString();

    await this.pace();
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      // Includes a timeout: the engine treats it as "no signal".
      throw new UpstreamError(UPSTREAM, "Last.fm could not be reached.", { cause: e });
    }
    // A body that stalls past the timeout rejects here and reads as malformed.
    const raw: unknown = await res.json().catch(() => undefined);
    const error = ErrorSchema.safeParse(raw);
    if (error.success) {
      if (error.data.error === ARTIST_NOT_FOUND) return null;
      throw new UpstreamError(UPSTREAM, `Last.fm error ${error.data.error}.`);
    }
    if (!res.ok) throw new UpstreamError(UPSTREAM, `Last.fm answered ${res.status}.`);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new UpstreamError(UPSTREAM, `Last.fm sent an unexpected response (${res.status}).`);
    }
    return parsed.data;
  }

  /** Spaces requests at least 200 ms apart within this process. */
  private async pace(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const at = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = at + MIN_REQUEST_INTERVAL_MS;
    if (at > now) await this.deps.sleep(at - now);
  }
}

const artistParams = (artistName: string, mbid?: string) => ({
  artist: artistName,
  ...(mbid ? { mbid } : {}),
});
const cacheKey = (artistName: string, mbid?: string) =>
  `${normalizeArtistName(artistName)}|${mbid ?? ""}`;

/** `artist.getTopTracks`, cached per artist for 24 hours. */
export class LastfmMostListened implements MostListenedSource {
  private readonly cache: TtlCache<MostListenedTrack[]>;

  constructor(
    deps: LastfmDeps,
    private readonly client = new LastfmClient(deps),
  ) {
    this.cache = new TtlCache(deps.clock);
  }

  topTracks(artistName: string, mbid?: string): Promise<MostListenedTrack[]> {
    return this.cache.getOrLoad(cacheKey(artistName, mbid), async () => {
      const body = await this.client.get(
        {
          method: "artist.gettoptracks",
          ...artistParams(artistName, mbid),
          limit: String(TOP_TRACKS_LIMIT),
        },
        TopTracksSchema,
      );
      return (body?.toptracks.track ?? []).map((t) => ({
        title: t.name,
        playcount: t.playcount,
        listeners: t.listeners,
      }));
    });
  }
}

/** `artist.getInfo` listeners, cached per artist for 7 days (D-065). Unknown artist → null. */
export class LastfmPopularity implements ArtistPopularitySource {
  private readonly cache: TtlCache<number | null>;

  constructor(
    deps: LastfmDeps,
    private readonly client = new LastfmClient(deps),
  ) {
    this.cache = new TtlCache(deps.clock, POPULARITY_TTL_MS);
  }

  async listeners(
    artistName: string,
    opts: { mbid?: string; cachedOnly?: boolean } = {},
  ): Promise<number | null> {
    const key = cacheKey(artistName, opts.mbid);
    if (opts.cachedOnly) return this.cache.get(key) ?? null;
    return this.cache.getOrLoad(key, async () => {
      const body = await this.client.get(
        { method: "artist.getinfo", ...artistParams(artistName, opts.mbid) },
        InfoSchema,
      );
      return body?.artist.stats.listeners ?? null;
    });
  }
}
