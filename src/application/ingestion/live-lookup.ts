/**
 * Live lookup for searches we know nothing about yet (D-050, D-057, D-070). Serverless-safe:
 *  - `lookup(q)` does the work inside the request with a hard 6-second cap and returns the
 *    final answer; nothing is left running in memory between requests;
 *  - answers are cached in Postgres by normalized query (found 10 min, ambiguous 10 min,
 *    not_found 30 min); a repeat answers from the cache;
 *  - `poll(lookupId)` answers from that cache only (or null → 404).
 * Steps: our own search → Spotify recognition → Wikipedia (finds become candidates for review,
 * D-055) and Ticketmaster when configured (events written `held`, D-056) → our search again.
 * Results come from our search, so they follow its visibility rules (published only).
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import type { IngestSummary, Suggestion } from "@/application/events";
import type { RateLimiter } from "@/application/ports/engagement";
import type { SourceAdapter, SourceFetchOptions } from "@/application/ports/event-source";
import type { Clock } from "@/application/ports/clock";
import {
  SpotifyBlockedError,
  type ArtistCatalog,
  type SpotifyArtistCandidate,
} from "@/application/ports/spotify";
import type { EventCandidate } from "@/domain/events/extract/candidate";
import { dedupeKey } from "@/domain/events/dedupe";
import { foldText } from "@/domain/events/text";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { RateLimitedError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { validateCandidates } from "./collect-events";
import type { CandidateStore } from "./ports";
import type { ArtistValidator } from "./validate-artists";

export const LookupRequestSchema = z.strictObject({ q: z.string().trim().min(2).max(100) });
export type LookupRequest = z.infer<typeof LookupRequestSchema>;

export type LookupArtist = { name: string; spotifyId: string; imageUrl: string | null };
export type LookupResponse =
  | { status: "found"; results: Suggestion[] }
  | {
      status: "not_found";
      /** The one artist the query clearly means (kept for older clients). */
      artist?: LookupArtist;
      /** Up to 3 Spotify candidates, best first. */
      artists?: LookupArtist[];
      /** True when the query could mean several artists ("olivia"). */
      ambiguous?: boolean;
      /**
       * D-073: possible upcoming India shows found for the artist and stored as candidates;
       * they're being verified and are never shown until the gate or the Lead publishes them.
       */
      checking?: number;
    }
  /** Only when the global cap is reached: nothing was looked up, try again later. */
  | { status: "searching" };
export type LookupResult = LookupResponse & { lookupId: string };

/** Hard cap on one lookup (D-057, D-070). */
export const LOOKUP_CAP_MS = 6000;
export const LOOKUP_TTL_MS = {
  found: 10 * 60_000,
  ambiguous: 10 * 60_000,
  not_found: 30 * 60_000,
} as const;
const RESOLVE_AFTER_INGEST = 25;

/** The Postgres-backed answer cache (D-070). */
export interface LookupCache {
  /** The cached answer if it hasn't expired, else null. */
  get(lookupId: string, now: Date): Promise<LookupResponse | null>;
  set(entry: {
    lookupId: string;
    queryKey: string;
    response: LookupResponse;
    expiresAt: Date;
  }): Promise<void>;
}

/** A stable ID per normalized query, so `GET /api/lookup/:id` can answer from the cache. */
export function lookupIdFor(q: string): string {
  return createHash("sha256").update(foldText(q)).digest("hex").slice(0, 32);
}

export type LiveLookupDeps = {
  catalog: ArtistCatalog;
  /** Wikipedia: upcoming Indian dates on the best tour/festival page for a term. */
  wikipedia: { lookUp(term: string, now: Date): Promise<EventCandidate[]> };
  /** A Ticketmaster keyword source, or null when no API key is configured. */
  ticketmaster: ((keyword: string) => SourceAdapter) | null;
  validator: ArtistValidator;
  /** Where Wikipedia finds wait for review (D-055). */
  store: CandidateStore;
  cache: LookupCache;
  ingest(adapter: SourceAdapter, opts: SourceFetchOptions): Promise<IngestSummary>;
  /** Our own search (the same engine as suggest), without logging. */
  search(q: string): Promise<Suggestion[]>;
  /** Artist matching for newly created artists; failures are logged, never surfaced. */
  resolvePendingArtists(limit: number): Promise<unknown>;
  clientLimiter: RateLimiter;
  globalLimiter: RateLimiter;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn" | "error">;
  /** Resolves after `ms`; injected so tests control time. */
  sleep(ms: number): Promise<void>;
  /** D-073: artist-first discovery for a recognised artist; returns candidate nights stored. */
  artistGigs?: { lookUp(artist: LookupArtist): Promise<number> };
};

export class LiveLookup {
  constructor(private readonly deps: LiveLookupDeps) {}

  /** The final answer within 6 seconds. Throws `RateLimitedError` when this client is over its budget. */
  async lookup(q: string, clientKey: string): Promise<LookupResult> {
    const lookupId = lookupIdFor(q);
    const now = this.deps.clock.now();
    const cached = await this.cached(lookupId, now);
    if (cached) return { ...cached, lookupId };
    if (!(await this.deps.clientLimiter.take(clientKey, now))) {
      throw new RateLimitedError("Too many lookups. Try again in a minute.");
    }
    // Over the global cap the query waits for the scheduled run (watch list).
    if (!(await this.deps.globalLimiter.take("global", now)))
      return { status: "searching", lookupId };

    const progress: { recognised: Recognised | null } = { recognised: null };
    const work = this.run(q, progress).catch((e: unknown) => {
      this.deps.logger.error({ err: e, q }, "lookup: failed");
      return null;
    });
    const capped = this.deps.sleep(LOOKUP_CAP_MS).then(() => "cap" as const);
    const result = await Promise.race([work, capped]);
    if (result === "cap") this.deps.logger.warn({ q }, "lookup: hit the 6s cap");
    const response = result === "cap" || result === null ? notFound(progress.recognised) : result;
    await this.remember(lookupId, foldText(q), response);
    return { ...response, lookupId };
  }

  /** The cached answer for a lookup ID, or null (unknown or expired). */
  async poll(lookupId: string): Promise<LookupResult | null> {
    const cached = await this.cached(lookupId, this.deps.clock.now());
    return cached ? { ...cached, lookupId } : null;
  }

  private async cached(lookupId: string, now: Date): Promise<LookupResponse | null> {
    try {
      return await this.deps.cache.get(lookupId, now);
    } catch (e) {
      this.deps.logger.warn({ err: e }, "lookup: cache read failed");
      return null;
    }
  }

  private async remember(lookupId: string, queryKey: string, response: LookupResponse) {
    const ttl =
      response.status === "found"
        ? LOOKUP_TTL_MS.found
        : response.status === "not_found" && response.ambiguous
          ? LOOKUP_TTL_MS.ambiguous
          : response.status === "not_found"
            ? LOOKUP_TTL_MS.not_found
            : 0;
    if (ttl === 0) return;
    try {
      await this.deps.cache.set({
        lookupId,
        queryKey,
        response,
        expiresAt: new Date(this.deps.clock.now().getTime() + ttl),
      });
    } catch (e) {
      this.deps.logger.warn({ err: e }, "lookup: cache write failed");
    }
  }

  private async run(
    q: string,
    progress: { recognised: Recognised | null },
  ): Promise<LookupResponse> {
    const existing = await this.deps.search(q);
    if (existing.length > 0) return { status: "found", results: existing };
    const recognised = await this.recognise(q);
    progress.recognised = recognised;
    const term = recognised.artist?.name ?? q;
    const now = this.deps.clock.now();
    const artist = recognised.artist;
    const [wiki, tm, gigs] = await Promise.allSettled([
      this.fromWikipedia(term, now),
      this.fromTicketmaster(term, now),
      artist && this.deps.artistGigs ? this.deps.artistGigs.lookUp(artist) : Promise.resolve(0),
    ]);
    for (const r of [wiki, tm, gigs]) {
      if (r.status === "rejected") {
        this.deps.logger.warn({ err: r.reason, q }, "lookup: source failed");
      }
    }
    if (tm.status === "fulfilled" && tm.value > 0) {
      try {
        await this.deps.resolvePendingArtists(RESOLVE_AFTER_INGEST);
      } catch (e) {
        this.deps.logger.warn({ err: e }, "lookup: artist matching failed");
      }
      const results = await this.deps.search(q);
      if (results.length > 0) return { status: "found", results };
    }
    const checking = gigs.status === "fulfilled" ? gigs.value : 0;
    const answer = notFound(recognised);
    return checking > 0 && answer.status === "not_found" ? { ...answer, checking } : answer;
  }

  /** Spotify candidates for the raw query. A Spotify block just skips recognition. */
  private async recognise(q: string): Promise<Recognised> {
    try {
      return recogniseArtist(q, await this.deps.catalog.searchArtists(q, { kind: "app" }));
    } catch (e) {
      if (e instanceof SpotifyBlockedError) return { artist: null, artists: [] };
      throw e;
    }
  }

  /** Wikipedia finds become candidates for review (D-055); returns how many were stored. */
  private async fromWikipedia(term: string, now: Date): Promise<number> {
    const candidates = await this.deps.wikipedia.lookUp(term, now);
    if (candidates.length === 0) return 0;
    const { validated } = await validateCandidates(this.deps.validator, candidates);
    for (const c of validated) await this.deps.store.upsert(c, dedupeKey(c), now);
    return validated.length;
  }

  /** Ticketmaster events are written through the normal ingest (as `held`, D-056). */
  private async fromTicketmaster(term: string, now: Date): Promise<number> {
    if (!this.deps.ticketmaster) return 0;
    const s = await this.deps.ingest(this.deps.ticketmaster(term), { from: now });
    return s.itemsNew + s.itemsMerged + s.itemsUpdated;
  }
}

/** What we know when the work stops: the recognised artist(s), if any. */
function notFound(recognised: Recognised | null): LookupResponse {
  if (recognised?.artist) {
    return { status: "not_found", artist: recognised.artist, artists: recognised.artists };
  }
  if (recognised && recognised.artists.length > 0) {
    return { status: "not_found", artists: recognised.artists, ambiguous: true };
  }
  return { status: "not_found" };
}

const MAX_CANDIDATES = 3;

export type Recognised = { artist: LookupArtist | null; artists: LookupArtist[] };

/**
 * How well a name matches the query: 2 when the normalized names are equal, 1 when the name
 * starts with the query's words ("diljit" → "Diljit Dosanjh"), else 0.
 */
function matchStrength(query: string, name: string): number {
  const q = normalizeArtistName(query);
  const n = normalizeArtistName(name);
  if (q === "" || n === "") return 0;
  if (q === n) return 2;
  return n.startsWith(`${q} `) ? 1 : 0;
}

/**
 * Which artist, if any, a typed query clearly means. The top Spotify result counts only when
 * it matches the query (exactly or by its leading words) and no other result matches as well:
 * "olivia rodrigo" and "diljit" are one artist; "olivia" (Rodrigo, Dean, …) is ambiguous.
 * `artists` lists up to three candidates by Spotify rank, those with a photo first.
 */
export function recogniseArtist(q: string, results: readonly SpotifyArtistCandidate[]): Recognised {
  const ranked = [...results].sort((a, b) => a.rank - b.rank);
  const toArtist = (r: SpotifyArtistCandidate): LookupArtist => ({
    name: r.name,
    spotifyId: r.id,
    imageUrl: r.imageUrl,
  });
  const artists = [
    ...ranked.filter((r) => r.imageUrl !== null),
    ...ranked.filter((r) => r.imageUrl === null),
  ]
    .slice(0, MAX_CANDIDATES)
    .map(toArtist);
  const top = ranked[0];
  if (!top) return { artist: null, artists };
  const strength = matchStrength(q, top.name);
  const rival = ranked.slice(1).some((r) => matchStrength(q, r.name) >= strength);
  return { artist: strength > 0 && !rival ? toArtist(top) : null, artists };
}
