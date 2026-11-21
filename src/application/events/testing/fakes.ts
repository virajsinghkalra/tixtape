/**
 * In-memory implementations of the events ports, for application tests. They follow the
 * same contracts as the Postgres repositories (idempotent creates, ConflictError on a
 * taken dedupe key) so use-case tests exercise real behaviour.
 */
import type { Artist, ArtistRepository } from "@/application/ports/artists";
import type { EventEngagement, RateLimiter, SearchLog } from "@/application/ports/engagement";
import type {
  EventSearch,
  Recommendations,
  SearchCandidates,
} from "@/application/ports/event-search";
import type { EventResult, SearchPlan } from "@/domain/events/search";
import type { EngagementKind } from "@/domain/events/trend";
import type { EventVisibility } from "@/domain/events/visibility";
import type {
  DedupeCandidate,
  AdminEventDetail,
  AdminEventSummary,
  EventAdminFields,
  EventListFilter,
  EventMerge,
  EventMergeOutcome,
  EventRecord,
  EventRepository,
  EventWrite,
  LineupRow,
} from "@/application/ports/events";
import type {
  IngestRunId,
  IngestRunRepository,
  IngestRunResult,
} from "@/application/ports/ingest-runs";
import type {
  NewVenue,
  Venue,
  VenueRepository,
  VenueWithAliases,
} from "@/application/ports/venues";
import {
  asArtistId,
  asEventId,
  asVenueId,
  type ArtistId,
  type EventId,
  type VenueId,
} from "@/domain/shared/ids";
import type { EventSource } from "@/domain/shared/lineup";
import { ConflictError, NotFoundError } from "@/lib/errors";

let seq = 0;
const nextId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export class FakeVenueRepository implements VenueRepository {
  readonly venues: VenueWithAliases[] = [];

  async findById(id: VenueId) {
    return this.strip(this.venues.find((v) => v.id === id));
  }
  async findByName(normalizedName: string, city: string) {
    return this.strip(
      this.venues.find(
        (v) =>
          v.city === city &&
          (v.normalizedName === normalizedName || v.aliases.includes(normalizedName)),
      ),
    );
  }
  async listByCity(city: string, country: string) {
    return this.venues
      .filter((v) => v.city === city && v.country === country)
      .map((v) => ({ ...v, aliases: [...v.aliases] }));
  }
  async create(venue: NewVenue): Promise<Venue> {
    const found = await this.findByName(venue.normalizedName, venue.city);
    if (found) return found;
    const created = { ...venue, id: asVenueId(nextId()), aliases: [] };
    this.venues.push(created);
    return this.strip(created)!;
  }
  async addAlias(venueId: VenueId, aliasNormalized: string) {
    const v = this.venues.find((x) => x.id === venueId);
    if (v && !v.aliases.includes(aliasNormalized)) v.aliases.push(aliasNormalized);
  }
  private strip(v: VenueWithAliases | undefined): Venue | null {
    if (!v) return null;
    const { aliases: _a, ...venue } = v;
    return venue;
  }
}

export class FakeArtistRepository implements ArtistRepository {
  readonly artists: Artist[] = [];
  readonly aliases = new Map<string, ArtistId>();

  async findOrCreateByName(name: string, normalizedName: string): Promise<Artist> {
    const existing = await this.findByAlias(normalizedName);
    if (existing) return existing;
    const artist: Artist = {
      id: asArtistId(nextId()),
      name,
      normalizedName,
      spotifyId: null,
      matchScore: null,
      matchStatus: "pending",
      imageUrl: null,
      spotifyResolvedAt: null,
    };
    this.artists.push(artist);
    this.aliases.set(normalizedName, artist.id);
    return artist;
  }
  async findById(id: ArtistId) {
    return this.artists.find((a) => a.id === id) ?? null;
  }
  async findByAlias(normalizedName: string) {
    const id = this.aliases.get(normalizedName);
    if (id) return this.findById(id);
    return this.artists.find((a) => a.normalizedName === normalizedName) ?? null;
  }
  async listNeedingResolution(): Promise<Artist[]> {
    return this.artists.filter((a) => a.matchStatus === "pending");
  }
  async listNeedingReview(): Promise<Artist[]> {
    return this.artists.filter((a) => a.matchStatus === "needs_review");
  }
  async recordMatch(): Promise<void> {}
  async addAlias(artistId: ArtistId, aliasNormalized: string) {
    this.aliases.set(aliasNormalized, artistId);
  }
}

type StoredEvent = Omit<EventRecord, "sources"> &
  EventAdminFields & {
    sources: { source: EventSource; externalId: string; url: string | null; lastSeenAt: Date }[];
    lineup: LineupRow[];
    createdAt: Date;
    updatedAt: Date;
  };

export class FakeEventRepository implements EventRepository, EventMerge {
  readonly events: StoredEvent[] = [];
  /** D-028 review queue: one row per (event, similar-to), latest score wins. */
  readonly mergeReviews: {
    eventId: EventId;
    similarTo: EventId;
    score: number;
    createdAt: Date;
  }[] = [];
  saves = 0;

  async recordMergeReview(eventId: EventId, similarTo: EventId, score: number): Promise<void> {
    const row = this.mergeReviews.find((r) => r.eventId === eventId && r.similarTo === similarTo);
    if (row) row.score = score;
    else this.mergeReviews.push({ eventId, similarTo, score, createdAt: new Date(0) });
  }

  async listMergeReviews(limit: number) {
    return this.mergeReviews.slice(0, limit);
  }

  /** Not exercised through the fakes; the Postgres repository is tested directly. */
  async mergeEvents(): Promise<EventMergeOutcome> {
    throw new Error("FakeEventRepository.mergeEvents is not implemented");
  }

  constructor(
    private readonly venues: FakeVenueRepository,
    private readonly artists: FakeArtistRepository,
  ) {}

  async findIdBySourceRef(source: EventSource, externalId: string) {
    const e = this.events.find((x) =>
      x.sources.some((s) => s.source === source && s.externalId === externalId),
    );
    return e?.id ?? null;
  }
  async findIdByDedupeKey(key: string) {
    return this.events.find((e) => e.dedupeKey === key)?.id ?? null;
  }
  async findById(id: EventId): Promise<EventRecord | null> {
    const e = this.events.find((x) => x.id === id);
    if (!e) return null;
    const { lineup: _l, createdAt: _c, updatedAt: _u, ...rest } = e;
    return { ...rest, sources: e.sources.map((s) => s.source) };
  }
  async listDedupeCandidates(block: {
    country: string;
    city: string;
    from: Date;
    to: Date;
  }): Promise<DedupeCandidate[]> {
    const out: DedupeCandidate[] = [];
    for (const e of this.events) {
      const venue = this.venues.venues.find((v) => v.id === e.venueId);
      if (!venue || venue.city !== block.city || venue.country !== block.country) continue;
      if (e.startsAt < block.from || e.startsAt > block.to) continue;
      out.push({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        country: venue.country,
        city: venue.city,
        venueName: venue.name,
        startsAtDateOnly: e.startsAtDateOnly,
        sources: [...new Set(e.sources.map((s) => s.source))],
        artistKeys: e.lineup.map(
          (r) => this.artists.artists.find((a) => a.id === r.artistId)!.normalizedName,
        ),
      });
    }
    return out;
  }
  async save(write: EventWrite): Promise<EventId> {
    this.saves++;
    const clash = this.events.find((e) => e.dedupeKey === write.dedupeKey && e.id !== write.id);
    if (clash) throw new ConflictError("Another event already has this title, date and city.");
    let e = this.events.find((x) => x.id === write.id);
    if (!e) {
      e = {
        ...write.fields,
        id: asEventId(nextId()),
        dedupeKey: write.dedupeKey,
        lineupHash: null,
        visibility: "held",
        confidence: 0,
        lastVerifiedAt: null,
        sources: [],
        lineup: [],
        createdAt: write.source.seenAt,
        updatedAt: write.source.seenAt,
      };
      this.events.push(e);
    }
    Object.assign(e, write.fields, { dedupeKey: write.dedupeKey, updatedAt: write.source.seenAt });
    if (write.visibility !== undefined) e.visibility = write.visibility;
    const externalId = write.source.externalId ?? e.id;
    const src = e.sources.find(
      (s) => s.source === write.source.source && s.externalId === externalId,
    );
    if (src) src.lastSeenAt = write.source.seenAt;
    else
      e.sources.push({
        source: write.source.source,
        externalId,
        url: write.source.url,
        lastSeenAt: write.source.seenAt,
      });
    if (write.lineup) {
      e.lineup = write.lineup.rows;
      e.lineupHash = write.lineup.hash;
    }
    return e.id;
  }
  async getDetail(id: EventId): Promise<AdminEventDetail | null> {
    const e = this.events.find((x) => x.id === id);
    if (!e) return null;
    return {
      ...this.summary(e),
      lineupHash: e.lineupHash,
      lineup: e.lineup.map((r) => {
        const a = this.artists.artists.find((x) => x.id === r.artistId)!;
        return {
          ...r,
          name: a.name,
          matchStatus: a.matchStatus,
          spotifyId: a.spotifyId,
          imageUrl: a.imageUrl,
        };
      }),
      sources: e.sources,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }
  async list(filter: EventListFilter) {
    const all = this.events
      .map((e) => this.summary(e))
      .filter((e) => filter.visibility === null || e.visibility === filter.visibility)
      .filter((e) => !filter.city || e.venue?.city === filter.city)
      .filter((e) => !filter.from || e.startsAt >= filter.from)
      .filter((e) => !filter.to || e.startsAt <= filter.to)
      .filter((e) => !filter.type || e.type === filter.type)
      .filter((e) => !filter.q || e.title.toLowerCase().includes(filter.q.toLowerCase()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return { items: all.slice(filter.offset, filter.offset + filter.limit), total: all.length };
  }
  private summary(e: StoredEvent): AdminEventSummary {
    const v = this.venues.venues.find((x) => x.id === e.venueId);
    return {
      id: e.id,
      title: e.title,
      type: e.type,
      status: e.status,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      genre: e.genre,
      imageUrl: e.imageUrl,
      venue: v ? { id: v.id, name: v.name, city: v.city, country: v.country } : null,
      artistCount: e.lineup.length,
      visibility: e.visibility,
      confidence: e.confidence,
      lastVerifiedAt: e.lastVerifiedAt,
    };
  }

  async setVisibility(id: EventId, visibility: EventVisibility) {
    const e = this.events.find((x) => x.id === id);
    if (!e) return false;
    e.visibility = visibility;
    return true;
  }

  /** Test helper: what the verification pipeline (not this team) would do. */
  markVerified(id: string, visibility: EventVisibility, lastVerifiedAt: Date | null = null) {
    const e = this.events.find((x) => x.id === id);
    if (!e) throw new Error(`no event ${id}`);
    Object.assign(e, { visibility, lastVerifiedAt });
  }
}

export class FakeIngestRunRepository implements IngestRunRepository {
  readonly runs: ({
    id: IngestRunId;
    source: EventSource;
    startedAt: Date;
  } & Partial<IngestRunResult>)[] = [];
  async start(source: EventSource, startedAt: Date) {
    const id = nextId() as IngestRunId;
    this.runs.push({ id, source, startedAt });
    return id;
  }
  async finish(id: IngestRunId, result: IngestRunResult) {
    Object.assign(
      this.runs.find((r) => r.id === id)!,
      result,
    );
  }
}

/** Returns preset lists and records what it was asked; ranking is the domain's job. */
export class FakeEventSearch implements EventSearch {
  candidates: SearchCandidates = { events: [], artists: [], cities: [] };
  fallbackEvents: EventResult[] = [];
  recommendations: Recommendations = {
    trending: [],
    upNext: [],
    thisWeekend: [],
    nearYou: [],
    popularSearches: [],
  };
  readonly calls: { plan: SearchPlan; now: Date; limit: number }[] = [];
  readonly fallbackCalls: { city: string | null; from: Date | null; to: Date | null }[] = [];
  readonly recommendationCalls: Parameters<EventSearch["findRecommendations"]>[0][] = [];
  async findCandidates(plan: SearchPlan, now: Date, limit: number) {
    this.calls.push({ plan, now, limit });
    return { ...this.candidates, events: this.candidates.events.slice(0, limit) };
  }
  async findFallback(filters: { city: string | null; from: Date | null; to: Date | null }) {
    this.fallbackCalls.push(filters);
    return filters.city
      ? this.fallbackEvents.filter((e) => e.city === filters.city)
      : this.fallbackEvents;
  }
  async findRecommendations(input: Parameters<EventSearch["findRecommendations"]>[0]) {
    this.recommendationCalls.push(input);
    return this.recommendations;
  }
}

export class FakeEngagement implements EventEngagement {
  readonly recorded: { eventId: EventId; kind: EngagementKind; at: Date }[] = [];
  constructor(private readonly visibilityOf: (id: string) => EventVisibility | null = () => null) {}
  async isPublished(eventId: EventId) {
    return this.visibilityOf(eventId) === "published";
  }
  async record(eventId: EventId, kind: EngagementKind, at: Date) {
    if (!(await this.isPublished(eventId))) throw new NotFoundError("That event doesn't exist.");
    this.recorded.push({ eventId, kind, at });
  }
}

export class FakeSearchLog implements SearchLog {
  readonly searches: { query: string; resultsCount: number; at: Date }[] = [];
  readonly clicks: { query: string; eventId: EventId; at: Date }[] = [];
  async recordSearch(query: string, resultsCount: number, at: Date) {
    this.searches.push({ query, resultsCount, at });
  }
  async recordClick(query: string, eventId: EventId, at: Date) {
    this.clicks.push({ query, eventId, at });
  }
  async listZeroResultQueries() {
    return [];
  }
  async deleteOlderThan() {
    return 0;
  }
}

/** Allows `limit` takes per key, forever (tests control time by building a new one). */
export class CountingLimiter implements RateLimiter {
  private readonly counts = new Map<string, number>();
  constructor(private readonly limit: number) {}
  async take(key: string) {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.limit;
  }
}

export function fakeEventsWorld(now = new Date("2026-01-15T00:00:00Z")) {
  const venues = new FakeVenueRepository();
  const artists = new FakeArtistRepository();
  const events = new FakeEventRepository(venues, artists);
  const ingestRuns = new FakeIngestRunRepository();
  const search = new FakeEventSearch();
  const engagement = new FakeEngagement(
    (id) => events.events.find((e) => e.id === id)?.visibility ?? null,
  );
  const searchLog = new FakeSearchLog();
  return {
    venues,
    artists,
    events,
    ingestRuns,
    search,
    engagement,
    searchLog,
    clientLimiter: new CountingLimiter(60) as RateLimiter,
    repeatLimiter: new CountingLimiter(1) as RateLimiter,
    clock: { now: () => now },
  };
}
