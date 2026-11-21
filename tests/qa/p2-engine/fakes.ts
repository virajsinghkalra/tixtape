/**
 * QA P2 fakes, written from the port contracts in src/application/ports/* only (not the dev
 * team's fakes). They record every call so tests can check ordering, chunking and leases.
 */
import { randomUUID } from "node:crypto";
import { createPlaylistsUseCases, type PlaylistsUseCases } from "@/application/playlists";
import type { StartLimiter } from "@/application/playlists";
import type { AuthUser, StoredSpotifyToken } from "@/application/auth/ports";
import type { EventDetail, LineupArtist } from "@/application/ports/events";
import type {
  ChartEntry,
  MostListenedSource,
  MostListenedTrack,
  NewReleaseSource,
  TrendingSource,
} from "@/application/ports/music-signals";
import {
  ACTIVE_JOB_STATUSES,
  JobCheckpointSchema,
  type EventLineupReader,
  type JobCheckpoint,
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
import {
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
import { NotFoundError } from "@/lib/errors";

export const NOW = new Date("2026-11-21T10:00:00Z");

export class ManualClock {
  t: number;
  constructor(start: Date = NOW) {
    this.t = start.getTime();
  }
  now = (): Date => new Date(this.t);
  advance(ms: number): void {
    this.t += ms;
  }
  set(d: Date): void {
    this.t = d.getTime();
  }
}

/** 22-char base62 ids with a readable prefix. */
const b62 = (prefix: string, n: number | string) =>
  `${prefix}${String(n).padStart(22 - prefix.length, "0")}`;
export const artistSid = (n: number | string): SpotifyArtistId => asSpotifyArtistId(b62("AR", n));
export const trackSid = (n: number | string): SpotifyTrackId => asSpotifyTrackId(b62("TR", n));
export const playlistSid = (n: number | string): SpotifyPlaylistId =>
  asSpotifyPlaylistId(b62("PL", n));

export const SECRET_ACCESS = "QA-ACCESS-TOKEN-do-not-leak-1f2e3d";
export const SECRET_REFRESH = "QA-REFRESH-TOKEN-do-not-leak-9a8b7c";

// ── Events ────────────────────────────────────────────────────────────────

export type ArtistSpec = {
  name: string;
  tier: BillingTier;
  rank: number;
  spotifyId: SpotifyArtistId | null;
};

export function makeEvent(
  id: EventId,
  artists: ArtistSpec[],
  lineupHash: string | null = "hash-1",
  title = "QA Fest 2026",
): EventDetail {
  const lineup: LineupArtist[] = artists.map((a, i) => ({
    artistId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` as LineupArtist["artistId"],
    name: a.name,
    billingRank: a.rank,
    tier: a.tier,
    day: null,
    stage: null,
    matchStatus: a.spotifyId ? "auto" : "not_found",
    spotifyId: a.spotifyId,
    imageUrl: null,
  }));
  return {
    id,
    title,
    type: "festival",
    status: "full_lineup",
    startsAt: new Date("2026-12-20T12:00:00Z"),
    endsAt: null,
    genre: null,
    imageUrl: null,
    venue: null,
    artistCount: lineup.length,
    lineupHash,
    lineup,
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/**
 * D-065: playlist length follows the show. For tests about chunking, leases and progress (not
 * length), this makes the show long enough (14 days × 23.5 h, IST) that every artist's time
 * budget is larger than their whole song pool, so the playlist holds every seeded song.
 */
export function wholePoolShow(e: EventDetail): EventDetail {
  return {
    ...e,
    startsAt: new Date("2026-12-19T18:30:00Z"),
    endsAt: new Date("2027-01-02T18:00:00Z"),
  };
}

export class FakeEvents implements EventLineupReader {
  readonly events = new Map<string, EventDetail>();
  calls = 0;
  put(e: EventDetail): void {
    this.events.set(e.id, e);
  }
  async getEvent(id: EventId): Promise<EventDetail> {
    this.calls += 1;
    const e = this.events.get(id);
    if (!e) throw new NotFoundError("That event doesn't exist.");
    return structuredClone(e);
  }
}

// ── Jobs ──────────────────────────────────────────────────────────────────

type StoredJob = PlaylistJob & { lockedUntil: Date | null };

export class FakeJobs implements PlaylistJobRepository {
  readonly jobs = new Map<string, StoredJob>();
  /** Every accepted save, in order. */
  readonly history: { jobId: string; update: JobUpdate }[] = [];
  rejectedSaves = 0;
  constructor(private readonly clock: ManualClock) {}

  private clone(j: StoredJob): PlaylistJob {
    const { lockedUntil: _l, ...rest } = structuredClone(j);
    return rest;
  }

  async findById(id: PlaylistJobId): Promise<PlaylistJob | null> {
    const j = this.jobs.get(id);
    return j ? this.clone(j) : null;
  }

  async findActiveShared(eventId: EventId): Promise<PlaylistJob | null> {
    for (const j of this.jobs.values())
      if (j.eventId === eventId && ACTIVE_JOB_STATUSES.includes(j.status)) return this.clone(j);
    return null;
  }

  /** Like Postgres, without the "stepped recently" rule (the fake keeps no update time). */
  async listDue(now: Date, limit: number): Promise<PlaylistJob[]> {
    return [...this.jobs.values()]
      .filter(
        (j) =>
          ACTIVE_JOB_STATUSES.includes(j.status) &&
          (!j.resumeAfter || j.resumeAfter <= now) &&
          (!j.lockedUntil || j.lockedUntil < now),
      )
      .slice(0, limit)
      .map((j) => this.clone(j));
  }

  async createShared(eventId: EventId): Promise<PlaylistJob | null> {
    // Check-and-insert is atomic, like the partial unique index.
    for (const x of this.jobs.values())
      if (x.eventId === eventId && ACTIVE_JOB_STATUSES.includes(x.status)) return null;
    const j: StoredJob = {
      id: asPlaylistJobId(randomUUID()),
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
    this.jobs.set(j.id, j);
    return this.clone(j);
  }

  async claim(
    id: PlaylistJobId,
    leaseMs: number,
  ): Promise<{ job: PlaylistJob; lease: JobLease } | null> {
    const j = this.jobs.get(id);
    const now = this.clock.now().getTime();
    if (!j || !ACTIVE_JOB_STATUSES.includes(j.status)) return null;
    if (j.lockedUntil && j.lockedUntil.getTime() >= now) return null;
    j.lockedUntil = new Date(now + leaseMs);
    return { job: this.clone(j), lease: { jobId: id, lockedUntil: new Date(j.lockedUntil) } };
  }

  async save(lease: JobLease, update: JobUpdate): Promise<boolean> {
    const j = this.jobs.get(lease.jobId);
    if (!j || !j.lockedUntil || j.lockedUntil.getTime() !== lease.lockedUntil.getTime()) {
      this.rejectedSaves += 1;
      return false;
    }
    // The real table has CHECK (progress between 0 and 100) and validates the checkpoint.
    if (update.progress !== undefined && (update.progress < 0 || update.progress > 100))
      throw new Error(`check constraint playlist_jobs_progress_range: ${update.progress}`);
    const target = j as Record<string, unknown>;
    for (const [k, v] of Object.entries(update)) {
      if (v === undefined) continue;
      if (k === "checkpoint")
        target[k] = v === null ? null : JobCheckpointSchema.parse(JSON.parse(JSON.stringify(v)));
      else target[k] = structuredClone(v);
    }
    this.history.push({ jobId: lease.jobId, update: structuredClone(update) });
    return true;
  }

  async release(lease: JobLease): Promise<void> {
    const j = this.jobs.get(lease.jobId);
    if (j?.lockedUntil && j.lockedUntil.getTime() === lease.lockedUntil.getTime())
      j.lockedUntil = null;
  }

  checkpoints(jobId: string): JobCheckpoint[] {
    return this.history
      .filter((h) => h.jobId === jobId && h.update.checkpoint)
      .map((h) => h.update.checkpoint as JobCheckpoint);
  }
}

// ── Shared playlists + writer ─────────────────────────────────────────────

export class FakeShared implements SharedPlaylistRepository {
  readonly rows = new Map<string, SharedPlaylist>();
  constructor(private readonly ops: string[]) {}
  async findByEvent(eventId: EventId): Promise<SharedPlaylist | null> {
    const r = this.rows.get(eventId);
    return r ? structuredClone(r) : null;
  }
  async saveCreated(
    eventId: EventId,
    p: { spotifyPlaylistId: SpotifyPlaylistId; url: string },
  ): Promise<SharedPlaylist> {
    this.ops.push(`saveCreated:${p.spotifyPlaylistId}`);
    const existing = this.rows.get(eventId);
    if (existing) return structuredClone(existing);
    for (const r of this.rows.values())
      if (r.spotifyPlaylistId === p.spotifyPlaylistId)
        throw new Error("unique spotify_playlist_id");
    const row: SharedPlaylist = {
      eventId,
      spotifyPlaylistId: p.spotifyPlaylistId,
      url: p.url,
      trackIds: [],
      snapshotId: null,
      lineupHashAtBuild: null,
      builtAt: NOW,
    };
    this.rows.set(eventId, row);
    return structuredClone(row);
  }
  async markBuilt(
    eventId: EventId,
    b: { trackIds: string[]; snapshotId: string | null; lineupHash: string | null; at: Date },
  ): Promise<void> {
    this.ops.push("markBuilt");
    const r = this.rows.get(eventId);
    if (!r) throw new Error("markBuilt without a row");
    r.trackIds = [...b.trackIds];
    r.snapshotId = b.snapshotId;
    r.lineupHashAtBuild = b.lineupHash;
    r.builtAt = b.at;
  }
}

type WriteHook = (
  kind: "add" | "replace",
  ids: SpotifyTrackId[],
  callNo: number,
) => Promise<void> | void;

export class FakeWriter implements PlaylistWriter {
  /** Actual contents of each Spotify playlist. */
  readonly playlists = new Map<string, SpotifyTrackId[]>();
  readonly calls: { kind: "create" | "add" | "replace"; userId: string; n: number }[] = [];
  createInputs: { name: string; description: string; public: boolean }[] = [];
  /** Runs before items are applied (throw or hang to inject failures). */
  before?: WriteHook;
  /** Runs after items are applied but before returning (simulate a crash after Spotify accepted). */
  after?: WriteHook;
  createError?: Error;
  private seq = 0;
  private writeNo = 0;
  constructor(private readonly ops: string[]) {}

  async createPlaylist(
    userId: string,
    input: { name: string; description: string; public: boolean },
  ): Promise<CreatedPlaylist> {
    if (this.createError) throw this.createError;
    this.seq += 1;
    const id = playlistSid(this.seq);
    this.calls.push({ kind: "create", userId, n: 0 });
    this.createInputs.push(input);
    this.playlists.set(id, []);
    this.ops.push(`create:${id}`);
    return { id, url: `https://open.spotify.com/playlist/${id}`, snapshotId: `snap-${this.seq}` };
  }

  private async write(
    kind: "add" | "replace",
    userId: string,
    playlistId: SpotifyPlaylistId,
    trackIds: SpotifyTrackId[],
  ): Promise<{ snapshotId: string }> {
    this.writeNo += 1;
    const no = this.writeNo;
    await this.before?.(kind, trackIds, no);
    this.calls.push({ kind, userId, n: trackIds.length });
    this.ops.push(`${kind}:${trackIds.length}`);
    if (trackIds.length > 100) throw new Error("Spotify 400: too many uris");
    const cur = this.playlists.get(playlistId);
    if (!cur) throw new Error(`Spotify 404: playlist ${playlistId}`);
    if (kind === "replace") this.playlists.set(playlistId, [...trackIds]);
    else cur.push(...trackIds);
    await this.after?.(kind, trackIds, no);
    return { snapshotId: `snap-w${no}` };
  }

  replaceItems(u: string, p: SpotifyPlaylistId, t: SpotifyTrackId[]) {
    return this.write("replace", u, p, t);
  }
  addItems(u: string, p: SpotifyPlaylistId, t: SpotifyTrackId[]) {
    return this.write("add", u, p, t);
  }
  count(kind: "create" | "add" | "replace"): number {
    return this.calls.filter((c) => c.kind === kind).length;
  }
}

// ── Catalog + signals ─────────────────────────────────────────────────────

/** Spotify search stand-in: finds the artist named in the query; `track:"X"` filters titles. */
export class FakeCatalog implements TrackCatalog {
  readonly byArtist = new Map<string, SpotifyTrack[]>();
  readonly names = new Map<string, SpotifyArtistId>();
  searches: string[] = [];
  onSearch?: (q: string) => void;

  addArtist(name: string, id: SpotifyArtistId, tracks: Partial<SpotifyTrack>[]): void {
    this.names.set(name.toLowerCase(), id);
    this.byArtist.set(
      id,
      tracks.map((t, i) => ({
        id: t.id ?? trackSid(`${id.slice(-6)}${i}`),
        name: t.name ?? `${name} Song ${i}`,
        artistIds: t.artistIds ?? [id],
        albumId: t.albumId ?? "album1",
        albumReleaseDate: t.albumReleaseDate ?? "2024-01-01",
        isrc: t.isrc === undefined ? null : t.isrc,
        durationMs: 200_000,
        rank: i,
      })),
    );
  }

  async searchTracks(query: string): Promise<SpotifyTrack[]> {
    this.searches.push(query);
    this.onSearch?.(query);
    const lower = query.toLowerCase();
    const names = [...this.names.keys()].sort((a, b) => b.length - a.length);
    const name = names.find((n) => lower.includes(n));
    if (!name) return [];
    let list = this.byArtist.get(this.names.get(name)!) ?? [];
    const m = /track:"([^"]*)"/iu.exec(query);
    if (m) {
      const want = m[1]!.toLowerCase().trim();
      list = list.filter((t) => t.name.toLowerCase().includes(want));
    }
    return list.slice(0, 10).map((t, i) => ({ ...t, rank: i }));
  }
  async getArtistAlbums(): Promise<SpotifyAlbum[]> {
    return [];
  }
  async getAlbumTracks(): Promise<SpotifyTrack[]> {
    return [];
  }
}

export class FakeMostListened implements MostListenedSource {
  readonly byName = new Map<string, MostListenedTrack[]>();
  error?: Error;
  async topTracks(name: string): Promise<MostListenedTrack[]> {
    if (this.error) throw this.error;
    return this.byName.get(name) ?? [];
  }
}
export class FakeTrending implements TrendingSource {
  entries: ChartEntry[] = [];
  error?: Error;
  async chart(): Promise<ChartEntry[]> {
    if (this.error) throw this.error;
    return this.entries;
  }
}
export class FakeNewReleases implements NewReleaseSource {
  readonly byArtist = new Map<string, SpotifyTrack[]>();
  async newestTracks(artistId: SpotifyArtistId): Promise<SpotifyTrack[]> {
    return this.byArtist.get(artistId) ?? [];
  }
}

// ── Publisher ─────────────────────────────────────────────────────────────

export const PUBLISHER = asUserId("22222222-2222-4222-8222-222222222222");

export class PublisherWorld {
  record: PublisherRecord | null = { userId: PUBLISHER, connectedAt: NOW };
  token: "ok" | "missing" | "reauth" = "ok";
  publisher: PublisherRepository = {
    find: async () => this.record,
    set: async (userId: UserId, at: Date) => {
      this.record = { userId, connectedAt: at };
    },
  };
  users = {
    findById: async (id: UserId): Promise<AuthUser | null> => ({
      id,
      spotifyUserId: "publisher-spotify",
      displayName: "Publisher",
      market: "IN",
      role: "admin",
    }),
  };
  tokens = {
    find: async (userId: UserId): Promise<StoredSpotifyToken | null> =>
      this.token === "missing"
        ? null
        : {
            userId,
            accessToken: SECRET_ACCESS,
            refreshToken: SECRET_REFRESH,
            scope: "playlist-modify-public",
            expiresAt: new Date(NOW.getTime() + 3600_000),
            needsReauth: this.token === "reauth",
          },
  };
}

export const allowAll: StartLimiter = { tryTake: async () => true, retryAfterSeconds: () => 0 };

// ── A whole engine on fakes ───────────────────────────────────────────────

export type World = ReturnType<typeof makeWorld>;

export function makeWorld(opts: { limiter?: StartLimiter } = {}) {
  const ops: string[] = [];
  const clock = new ManualClock();
  const jobs = new FakeJobs(clock);
  const shared = new FakeShared(ops);
  const writer = new FakeWriter(ops);
  const events = new FakeEvents();
  const tracks = new FakeCatalog();
  const mostListened = new FakeMostListened();
  const trending = new FakeTrending();
  const newReleases = new FakeNewReleases();
  const pub = new PublisherWorld();
  const warnings: unknown[][] = [];
  const logger = { warn: (...a: unknown[]) => void warnings.push(a) } as never;
  const uc: PlaylistsUseCases = createPlaylistsUseCases({
    jobs,
    shared,
    events,
    trending,
    writer,
    tracks,
    mostListened,
    newReleases,
    logger,
    publisher: pub.publisher,
    users: pub.users,
    tokens: pub.tokens,
    clock,
    limiter: opts.limiter ?? allowAll,
  });
  return {
    ops,
    clock,
    jobs,
    shared,
    writer,
    events,
    tracks,
    mostListened,
    trending,
    newReleases,
    pub,
    warnings,
    uc,
  };
}

/** Adds `n` matched artists of `tier`, each with `perArtist` searchable songs. */
export function seedArtists(
  w: World,
  n: number,
  tier: BillingTier,
  perArtist: number,
  startRank = 1,
  prefix: string = tier,
): ArtistSpec[] {
  const out: ArtistSpec[] = [];
  for (let i = 0; i < n; i += 1) {
    const name = `${prefix} Artist ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`;
    const id = artistSid(`${prefix}${i}`);
    w.tracks.addArtist(
      name,
      id,
      Array.from({ length: perArtist }, (_, k) => ({
        id: trackSid(`${prefix}${i}x${k}`),
        name: `${name} Track ${k}`,
      })),
    );
    out.push({ name, tier, rank: startRank + i, spotifyId: id });
  }
  return out;
}

export const EVENT = asEventId("33333333-3333-4333-8333-333333333333");

/** Steps until finished (or `max` steps), 1.5 s apart, jumping to `resumeAfter` when paused. */
export async function runToEnd(w: World, jobId: PlaylistJobId, max = 300) {
  const seen = [];
  for (let i = 0; i < max; i += 1) {
    const p = await w.uc.step(jobId);
    seen.push(p);
    if (["succeeded", "partial", "failed"].includes(p.status)) return { last: p, seen };
    if (p.resumeAfter && p.resumeAfter.getTime() > w.clock.t)
      w.clock.set(new Date(new Date(p.resumeAfter).getTime() + 1));
    else w.clock.advance(1_500);
  }
  return { last: seen[seen.length - 1]!, seen };
}
