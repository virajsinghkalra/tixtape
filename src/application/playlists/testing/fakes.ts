/** Test fakes for the Playlist Engine ports. They follow the port contracts (leases included). */
import type { SpotifyTokenRepository, StoredSpotifyToken } from "@/application/auth/ports";
import type { Clock } from "@/application/ports/clock";
import type { EventDetail, LineupArtist } from "@/application/ports/events";
import type {
  ArtistPopularitySource,
  ChartEntry,
  MostListenedSource,
  MostListenedTrack,
  NewReleaseSource,
  TrendingSource,
} from "@/application/ports/music-signals";
import {
  ACTIVE_JOB_STATUSES,
  type EventLineupReader,
  type JobLease,
  type JobUpdate,
  type PlaylistJob,
  type PlaylistJobRepository,
  type PublisherRecord,
  type PublisherRepository,
  type SharedPlaylist,
  type SharedPlaylistRepository,
} from "@/application/ports/playlists";
import type {
  CreatedPlaylist,
  PlaylistWriter,
  SpotifyAlbum,
  SpotifyTrack,
  TrackCatalog,
} from "@/application/ports/spotify";
import { normalizeTrackTitle } from "@/domain/playlists/track-title";
import {
  asArtistId,
  asEventId,
  asPlaylistJobId,
  asSpotifyArtistId,
  asSpotifyPlaylistId,
  asSpotifyTrackId,
  asUserId,
  type EventId,
  type PlaylistJobId,
  type SpotifyArtistId,
  type SpotifyPlaylistId,
  type SpotifyTrackId,
  type UserId,
} from "@/domain/shared/ids";
import type { BillingTier } from "@/domain/shared/lineup";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { NotFoundError } from "@/lib/errors";
import { createPlaylistsUseCases, type PlaylistsUseCases } from "../index";
import { FixedWindowLimiter } from "../start-limiter";

/** A clock tests move by hand; Spotify fakes advance it per call to model the step budget. */
export class FakeClock implements Clock {
  constructor(private ms = Date.parse("2026-11-21T10:00:00Z")) {}
  now = () => new Date(this.ms);
  advance(ms: number): void {
    this.ms += ms;
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export class InMemoryJobRepository implements PlaylistJobRepository {
  readonly rows = new Map<PlaylistJobId, PlaylistJob & { lockedUntil: Date | null }>();
  private nextId = 1;

  constructor(private readonly clock: Clock) {}

  async findById(id: PlaylistJobId) {
    return this.strip(this.rows.get(id));
  }

  async findActiveShared(eventId: EventId) {
    return this.strip(
      [...this.rows.values()].find(
        (j) => j.eventId === eventId && ACTIVE_JOB_STATUSES.includes(j.status),
      ),
    );
  }

  async createShared(eventId: EventId) {
    // Checked and inserted in one tick, like the partial unique index.
    const active = [...this.rows.values()].some(
      (j) => j.eventId === eventId && ACTIVE_JOB_STATUSES.includes(j.status),
    );
    if (active) return null;
    const id = asPlaylistJobId(
      `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`,
    );
    const job: PlaylistJob & { lockedUntil: Date | null } = {
      id,
      eventId,
      status: "queued",
      stage: null,
      progress: 0,
      artistsDone: 0,
      artistsTotal: 0,
      checkpoint: null,
      resumeAfter: null,
      error: null,
      lockedUntil: null,
    };
    this.rows.set(id, job);
    return this.strip(job);
  }

  /** Like Postgres, without the "stepped recently" rule (the fake keeps no update time). */
  async listDue(now: Date, limit: number) {
    return [...this.rows.values()]
      .filter(
        (j) =>
          ACTIVE_JOB_STATUSES.includes(j.status) &&
          (!j.resumeAfter || j.resumeAfter <= now) &&
          (!j.lockedUntil || j.lockedUntil < now),
      )
      .slice(0, limit)
      .map((j) => this.strip(j)!);
  }

  async claim(id: PlaylistJobId, leaseMs: number) {
    await tick(); // let a concurrent step interleave, as a real round trip would
    const row = this.rows.get(id);
    const now = this.clock.now();
    if (!row || !ACTIVE_JOB_STATUSES.includes(row.status)) return null;
    if (row.lockedUntil && row.lockedUntil >= now) return null;
    row.lockedUntil = new Date(now.getTime() + leaseMs);
    return { job: this.strip(row)!, lease: { jobId: id, lockedUntil: row.lockedUntil } };
  }

  async save(lease: JobLease, update: JobUpdate) {
    const row = this.rows.get(lease.jobId);
    if (!row || row.lockedUntil?.getTime() !== lease.lockedUntil.getTime()) return false;
    if (!ACTIVE_JOB_STATUSES.includes(row.status)) return false; // finished jobs stay finished
    Object.assign(row, structuredClone(update));
    return true;
  }

  async release(lease: JobLease) {
    const row = this.rows.get(lease.jobId);
    if (row && row.lockedUntil?.getTime() === lease.lockedUntil.getTime()) row.lockedUntil = null;
  }

  /** Simulates a killed step: its lease simply runs out. */
  expireLeases(): void {
    for (const row of this.rows.values()) row.lockedUntil = null;
  }

  private strip(row: (PlaylistJob & { lockedUntil: Date | null }) | undefined) {
    if (!row) return null;
    const { lockedUntil: _lockedUntil, ...job } = structuredClone(row);
    return job as PlaylistJob;
  }
}

export class InMemorySharedPlaylists implements SharedPlaylistRepository {
  readonly rows = new Map<EventId, SharedPlaylist>();
  constructor(private readonly clock: Clock) {}

  async findByEvent(eventId: EventId) {
    return this.rows.get(eventId) ?? null;
  }

  async saveCreated(eventId: EventId, p: { spotifyPlaylistId: SpotifyPlaylistId; url: string }) {
    const existing = this.rows.get(eventId);
    if (existing) return existing;
    const row: SharedPlaylist = {
      eventId,
      ...p,
      trackIds: [],
      snapshotId: null,
      lineupHashAtBuild: null,
      builtAt: this.clock.now(),
    };
    this.rows.set(eventId, row);
    return row;
  }

  async markBuilt(
    eventId: EventId,
    b: { trackIds: string[]; snapshotId: string | null; lineupHash: string | null; at: Date },
  ) {
    const row = this.rows.get(eventId);
    if (!row) throw new Error("markBuilt before saveCreated");
    Object.assign(row, {
      trackIds: b.trackIds,
      snapshotId: b.snapshotId,
      lineupHashAtBuild: b.lineupHash,
      builtAt: b.at,
    });
  }
}

export class InMemoryPublisher implements PublisherRepository {
  row: PublisherRecord | null = null;
  async find() {
    return this.row;
  }
  async set(userId: UserId, at: Date) {
    this.row = { userId, connectedAt: at };
  }
}

export class FakeTokens implements Pick<SpotifyTokenRepository, "find"> {
  readonly rows = new Map<UserId, StoredSpotifyToken>();
  add(userId: UserId, needsReauth = false): void {
    this.rows.set(userId, {
      userId,
      needsReauth,
      accessToken: "a",
      refreshToken: "r",
      scope: "",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });
  }
  async find(userId: UserId) {
    return this.rows.get(userId) ?? null;
  }
}

type FakeArtist = { id: SpotifyArtistId; name: string; tracks: SpotifyTrack[] };
type Op = "search" | "albums" | "albumTracks" | "create" | "replace" | "add";

/**
 * An in-memory Spotify: a catalog for `TrackCatalog` and playlists for `PlaylistWriter`.
 * Every call advances the clock by `callMs`. `failNext` makes the next call of an op throw.
 */
export class FakeSpotify implements TrackCatalog, PlaylistWriter {
  readonly artists: FakeArtist[] = [];
  readonly playlists = new Map<SpotifyPlaylistId, SpotifyTrackId[]>();
  readonly calls: Op[] = [];
  private readonly failures: { op: Op; error: Error; afterEffect: boolean }[] = [];
  private nextPlaylist = 1;

  constructor(
    private readonly clock: FakeClock,
    private readonly callMs = 300,
  ) {}

  /** Adds an artist with `count` tracks named "<name> Song <i>", each `durationMs` long. */
  addArtist(name: string, count = 12, durationMs = 200_000): FakeArtist {
    const slug = name.replace(/\W/gu, "");
    const id = asSpotifyArtistId(`${slug}Id`);
    const tracks = Array.from({ length: count }, (_, i) => ({
      id: asSpotifyTrackId(`${slug}T${i}`),
      name: `${name} Song ${i}`,
      artistIds: [id],
      albumId: `${slug}Album${Math.floor(i / 4)}`,
      albumReleaseDate: `20${10 + Math.floor(i / 4)}-01-01`,
      isrc: `IN-${slug}-${i}`.toUpperCase(),
      durationMs,
      rank: i,
    }));
    const artist = { id, name, tracks };
    this.artists.push(artist);
    return artist;
  }

  /**
   * The next call of `op` throws `error`. With `afterEffect`, the write still lands first:
   * a step killed after Spotify applied the change but before we saved the checkpoint.
   */
  failNext(op: Op, error: Error, opts: { afterEffect?: boolean } = {}): void {
    this.failures.push({ op, error, afterEffect: opts.afterEffect ?? false });
  }

  private async call(op: Op, effect: () => void = () => {}): Promise<void> {
    await tick();
    this.calls.push(op);
    this.clock.advance(this.callMs);
    const i = this.failures.findIndex((f) => f.op === op);
    if (i >= 0) {
      const [failure] = this.failures.splice(i, 1);
      if (failure!.afterEffect) effect();
      throw failure!.error;
    }
    effect();
  }

  async searchTracks(query: string, _market: string): Promise<SpotifyTrack[]> {
    await this.call("search");
    const artistName = /artist:"([^"]+)"/u.exec(query)?.[1] ?? "";
    const title = /track:"([^"]+)"/u.exec(query)?.[1];
    const artist = this.artists.find(
      (a) => normalizeArtistName(a.name) === normalizeArtistName(artistName),
    );
    if (!artist) return [];
    const hits = title
      ? artist.tracks.filter((t) => normalizeTrackTitle(t.name) === normalizeTrackTitle(title))
      : artist.tracks;
    return hits.slice(0, 10);
  }

  async getArtistAlbums(artistId: SpotifyArtistId): Promise<SpotifyAlbum[]> {
    await this.call("albums");
    const artist = this.artists.find((a) => a.id === artistId);
    const albums = new Map<string, SpotifyAlbum>();
    for (const t of artist?.tracks ?? []) {
      albums.set(t.albumId, {
        id: t.albumId,
        name: t.albumId,
        releaseDate: t.albumReleaseDate,
        albumType: "album",
      });
    }
    return [...albums.values()];
  }

  async getAlbumTracks(albumId: string): Promise<SpotifyTrack[]> {
    await this.call("albumTracks");
    return this.artists.flatMap((a) => a.tracks).filter((t) => t.albumId === albumId);
  }

  async createPlaylist(): Promise<CreatedPlaylist> {
    const id = asSpotifyPlaylistId(`pl${this.nextPlaylist++}`);
    await this.call("create", () => this.playlists.set(id, []));
    return { id, url: `https://open.spotify.com/playlist/${id}`, snapshotId: "s0" };
  }

  async replaceItems(_u: string, playlistId: SpotifyPlaylistId, ids: SpotifyTrackId[]) {
    await this.call("replace", () => this.playlists.set(playlistId, [...ids]));
    return { snapshotId: `snap-${this.calls.length}` };
  }

  async addItems(_u: string, playlistId: SpotifyPlaylistId, ids: SpotifyTrackId[]) {
    await this.call("add", () =>
      this.playlists.set(playlistId, [...(this.playlists.get(playlistId) ?? []), ...ids]),
    );
    return { snapshotId: `snap-${this.calls.length}` };
  }
}

/** Last.fm-like and Apple-like signals backed by plain maps. */
export class FakeSignals implements MostListenedSource, TrendingSource, ArtistPopularitySource {
  readonly top = new Map<string, MostListenedTrack[]>();
  readonly fans = new Map<string, number>();
  chartEntries: ChartEntry[] = [];
  /** Fake time each Last.fm/Apple call takes (models slow signals). */
  callMs = 0;
  clock: FakeClock | null = null;

  async listeners(artistName: string) {
    this.clock?.advance(this.callMs);
    return this.fans.get(artistName) ?? null;
  }

  async topTracks(artistName: string) {
    this.clock?.advance(this.callMs);
    return this.top.get(artistName) ?? [];
  }
  async chart() {
    return this.chartEntries;
  }
}

/** Newest releases straight from the fake catalog (album release date, newest first). */
export function fakeNewReleases(spotify: FakeSpotify): NewReleaseSource {
  return {
    async newestTracks(artistId, market, limit) {
      const albums = await spotify.getArtistAlbums(artistId);
      albums.sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""));
      const first = albums[0];
      return first ? (await spotify.getAlbumTracks(first.id)).slice(0, limit) : [];
    },
  };
}

export class FakeEvents implements EventLineupReader {
  readonly rows = new Map<EventId, EventDetail>();

  add(
    lineup: { name: string; tier: BillingTier; spotifyId: SpotifyArtistId | null }[],
    over: Partial<EventDetail> = {},
  ): EventDetail {
    const id = asEventId(`7d0c1f8e-0000-4000-8000-${String(this.rows.size + 1).padStart(12, "0")}`);
    const event: EventDetail = {
      id,
      title: "NH7 Weekender",
      type: "festival",
      status: "full_lineup",
      startsAt: new Date("2026-12-05T10:00:00Z"),
      endsAt: null,
      genre: null,
      imageUrl: null,
      venue: null,
      artistCount: lineup.length,
      lineupHash: "hash-1",
      lineup: lineup.map((a, i): LineupArtist => ({
        artistId: asArtistId(`artist-${i}`),
        name: a.name,
        billingRank: i + 1,
        tier: a.tier,
        day: null,
        stage: null,
        matchStatus: a.spotifyId ? "auto" : "not_found",
        spotifyId: a.spotifyId,
        imageUrl: null,
      })),
      sources: [],
      createdAt: new Date("2026-11-01T00:00:00Z"),
      updatedAt: new Date("2026-11-01T00:00:00Z"),
      ...over,
    };
    this.rows.set(id, event);
    return event;
  }

  async getEvent(id: EventId) {
    const e = this.rows.get(id);
    if (!e) throw new NotFoundError("That event doesn't exist.");
    return structuredClone(e);
  }
}

export const PUBLISHER_ID = asUserId("11111111-1111-4111-8111-111111111111");

/** Everything wired together with a connected, healthy publisher. */
export function playlistWorld(opts: { callMs?: number; startsPerHour?: number } = {}) {
  const clock = new FakeClock();
  const spotify = new FakeSpotify(clock, opts.callMs);
  const signals = new FakeSignals();
  signals.clock = clock;
  const jobs = new InMemoryJobRepository(clock);
  const shared = new InMemorySharedPlaylists(clock);
  const publisher = new InMemoryPublisher();
  const tokens = new FakeTokens();
  const events = new FakeEvents();
  const warnings: unknown[][] = [];
  const logger = { warn: (...args: unknown[]) => void warnings.push(args) };
  publisher.row = { userId: PUBLISHER_ID, connectedAt: clock.now() };
  tokens.add(PUBLISHER_ID);
  const useCases: PlaylistsUseCases = createPlaylistsUseCases({
    tracks: spotify,
    writer: spotify,
    mostListened: signals,
    trending: signals,
    popularity: signals,
    newReleases: fakeNewReleases(spotify),
    jobs,
    shared,
    events,
    publisher,
    tokens,
    users: { findById: async (id) => (id === PUBLISHER_ID ? publisherUser : null) },
    clock,
    logger,
    limiter: new FixedWindowLimiter(opts.startsPerHour ?? 100, 3_600_000, clock),
  });
  return { clock, spotify, signals, jobs, shared, publisher, tokens, events, warnings, useCases };
}

const publisherUser = {
  id: PUBLISHER_ID,
  spotifyUserId: "lineupmixes",
  displayName: "Tixtape",
  market: "IN",
  role: "admin" as const,
};
