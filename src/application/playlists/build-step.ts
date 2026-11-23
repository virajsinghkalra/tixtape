/**
 * One step of a shared playlist build (P2.2, D-005, D-036). A step claims the job's lease,
 * does at most ~8 s of work in small units, checkpoints after each unit and returns progress.
 * Stages: select (D-080: one uncached artist resolved per unit, ≤ 3 Spotify calls; cached
 * artists cost nothing; then every artist is picked at once, D-065) → create → write (one
 * 100-track chunk per unit). With a warm cache a build is create + ≤ 3 writes.
 */
import type { ChartEntry, TrendingSource } from "@/application/ports/music-signals";
import type {
  ArtistSongs,
  ArtistSongsCache,
  EventLineupReader,
  JobCheckpoint,
  JobLease,
  JobUpdate,
  PlaylistJob,
  PlaylistJobRepository,
  SharedPlaylistRepository,
} from "@/application/ports/playlists";
import {
  ReauthRequiredError,
  SpotifyBlockedError,
  type PlaylistWriter,
} from "@/application/ports/spotify";
import { playlistDescription, playlistName } from "@/domain/playlists/naming";
import { AVG_SONG_MS } from "@/domain/playlists/budget";
import { orderPlaylist, pickedTrack, type TrackCandidate } from "@/domain/playlists/selection";
import type { PickedTrack } from "@/domain/playlists/selection";
import type { ArtistId, PlaylistJobId, SpotifyTrackId } from "@/domain/shared/ids";
import { NotFoundError, UpstreamError } from "@/lib/errors";
import { UNAVAILABLE_MESSAGE } from "./errors";
import { budgetsFor, planBuild, type BuildPlan } from "./plan";
import {
  enrichArtistSongs,
  entryFor,
  isUsable,
  missingProviders,
  pickFromSongs,
  resolveArtistSongs,
  type ArtistSongsDeps,
} from "./artist-songs";
import { CHUNK_SIZE, progressFor, toProgress, type BuildProgress } from "./progress";
import { getPublisher, type PublisherDeps, type PublisherProblem } from "./publisher";

/** How many songs "what's inside" shows. */
export const PREVIEW_TRACKS = 4;

/**
 * D-085: the song-selection algorithm version, stored with every built playlist. A playlist
 * built by an older version is stale, exactly like a lineup change, and is rebuilt into the
 * same Spotify playlist. 1 = fixed per-tier counts (D-038); 2 = show-length budgets (D-065),
 * cached songs (D-080) and live setlists (D-085); 3 = tier minutes (D-093) and album top-up.
 * Bump it when picking changes for everyone.
 */
export const PLAYLIST_ALGORITHM_VERSION = 3; // 3: D-093 tier minutes + the 8-song fix

export const STEP_BUDGET_MS = 8_000;
/**
 * No new unit of work starts after this much of a step (D-005, Lead bug report): a unit is at
 * most a few requests of REQUEST_TIMEOUT_MS, so the step ends near STEP_BUDGET_MS.
 */
export const UNIT_START_LIMIT_MS = 6_000;
export const LEASE_MS = 15_000;
/** D-045: every outbound request in a step gives up after this long. */
export const REQUEST_TIMEOUT_MS = 4_000;
/**
 * The longest one Spotify write can take with the engine's retry settings: 2 attempts of
 * REQUEST_TIMEOUT_MS plus one wait of at most 5 s. A write starts only if the lease has at least
 * this long left, so it can't land after the lease is gone and another step took over (QA-P-3).
 */
export const WRITE_LEASE_MARGIN_MS = 2 * REQUEST_TIMEOUT_MS + 5_000;
/** A Spotify pause at most this long keeps the job running; the client simply steps again. */
export const SHORT_PAUSE_MS = 30_000;

export type BuildDeps = ArtistSongsDeps &
  PublisherDeps & {
    songsCache: ArtistSongsCache;
    jobs: PlaylistJobRepository;
    shared: SharedPlaylistRepository;
    events: EventLineupReader;
    trending: TrendingSource;
    writer: PlaylistWriter;
    alertUnavailable: (problem: PublisherProblem) => void;
  };

/** The lease is gone, or too short for the next write: stop and let the next step go on. */
class LeaseLostError extends Error {}

export async function stepBuild(deps: BuildDeps, jobId: PlaylistJobId): Promise<BuildProgress> {
  await currentProgress(deps, jobId); // D-058: 404 before claiming or doing any work
  // D-070: the lease is stamped with the DB clock; we measure its age on the app clock from
  // just before the claim, so both readings come from one clock (and err on the safe side).
  const claimStartedAt = deps.clock.now().getTime();
  const claimed = await deps.jobs.claim(jobId, LEASE_MS);
  if (!claimed) return currentProgress(deps, jobId);
  const { job, lease } = claimed;
  try {
    if (job.resumeAfter && job.resumeAfter > deps.clock.now()) return toProgress(job);
    return await new BuildRun(deps, job, lease, claimStartedAt).run();
  } catch (e) {
    if (e instanceof LeaseLostError) return currentProgress(deps, jobId);
    throw e;
  } finally {
    await deps.jobs.release(lease);
  }
}

export async function currentProgress(
  deps: Pick<BuildDeps, "jobs" | "events">,
  jobId: PlaylistJobId,
): Promise<BuildProgress> {
  const job = await deps.jobs.findById(jobId);
  if (!job) throw new NotFoundError("That playlist job doesn't exist.");
  await deps.events.getEvent(job.eventId); // D-058: held, archived or missing event → 404
  return toProgress(job);
}

const chunksOf = (ids: readonly SpotifyTrackId[]) => {
  const out: SpotifyTrackId[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) out.push(ids.slice(i, i + CHUNK_SIZE));
  return out;
};

function freshCheckpoint(plan: BuildPlan): JobCheckpoint {
  return {
    stage: "select",
    lineupHash: plan.lineupHash,
    artistIndex: 0,
    picks: [],
    unresolved: [...plan.unmatched],
    pickedTrackIds: [],
    playlistId: null,
    playlistUrl: null,
    chunksDone: 0,
    chunkInFlight: null,
    snapshotId: null,
  };
}

class BuildRun {
  private cp: JobCheckpoint | null;
  private chart: Promise<ChartEntry[]> | undefined;
  private lastUnitStart = 0;

  constructor(
    private readonly deps: BuildDeps,
    private job: PlaylistJob,
    private readonly lease: JobLease,
    /** App-clock time just before the claim: the lease ends LEASE_MS after it at the latest. */
    private readonly claimStartedAt: number,
  ) {
    this.cp = job.checkpoint;
  }

  async run(): Promise<BuildProgress> {
    this.lastUnitStart = this.deps.clock.now().getTime() + UNIT_START_LIMIT_MS;
    const publisher = await getPublisher(this.deps);
    if (!publisher.ok) {
      this.deps.alertUnavailable(publisher.error);
      return this.fail(UNAVAILABLE_MESSAGE);
    }
    let plan: BuildPlan;
    try {
      plan = planBuild(await this.deps.events.getEvent(this.job.eventId));
    } catch (e) {
      if (e instanceof NotFoundError) return this.fail("This event no longer exists.");
      throw e;
    }
    if (plan.artists.length === 0) {
      return this.fail("None of this lineup's artists are on Spotify yet.");
    }
    // A lineup change restarts selection; the playlist itself is reused at the create stage.
    if (!this.cp || this.cp.lineupHash !== plan.lineupHash) this.cp = freshCheckpoint(plan);
    await this.save({ status: "running", resumeAfter: null, artistsTotal: plan.artists.length });

    try {
      while (this.cp.stage !== "done" && this.job.status === "running") {
        if (!this.inTime()) break;
        await this.unit(plan, publisher.value.userId);
      }
    } catch (e) {
      if (e instanceof SpotifyBlockedError) return this.blocked(e);
      if (e instanceof ReauthRequiredError) {
        this.deps.alertUnavailable("needs_reauth");
        return this.fail(UNAVAILABLE_MESSAGE);
      }
      throw e;
    }
    return toProgress(this.job);
  }

  private async unit(plan: BuildPlan, publisherId: string): Promise<void> {
    const cp = this.checkpoint();
    if (cp.stage === "select") return this.selectNext(plan, cp);
    if (cp.stage === "create") return this.createPlaylist(plan, cp, publisherId);
    if (cp.stage === "write") return this.writeNext(cp, publisherId);
  }

  /**
   * D-080: resolves the next artist whose cached songs are missing, stale or too shallow for
   * their budget (one unit, ≤ 3 Spotify calls). Cached artists are skipped at no cost; once
   * every artist is cached, all of them are picked in one go.
   */
  private async selectNext(plan: BuildPlan, cp: JobCheckpoint): Promise<void> {
    const cache = await this.songs(plan);
    const now = this.deps.clock.now();
    const targets = budgetsFor(
      plan,
      plan.artists.map((a) => entryFor(cache, a)?.listeners ?? null),
    );
    let index = cp.artistIndex;
    while (index < plan.artists.length) {
      const artist = plan.artists[index]!;
      const entry = entryFor(cache, artist);
      const usable = isUsable(entry, targets[index]?.songs ?? 1, now);
      if (!usable || missingProviders(this.deps, entry!).length > 0) break;
      index++;
    }
    const artist = plan.artists[index];
    if (!artist) return this.finishSelection(plan, cp, cache);
    const entry = entryFor(cache, artist);
    const targetSongs = targets[index]?.songs ?? 1;
    let songs: ArtistSongs;
    if (entry && isUsable(entry, targetSongs, now)) {
      // D-085: an entry cached before a provider existed only needs that provider (no Spotify).
      songs = await enrichArtistSongs(this.deps, entry, artist.name);
    } else {
      // Continue this artist's resolution where the last step left it (after a pause or the
      // step's time), never from scratch: starting over could loop forever on a busy budget.
      const resume = cp.resolving?.artistIndex === index ? cp.resolving.state : undefined;
      const outcome = await resolveArtistSongs(this.deps, {
        artist,
        market: plan.market,
        targetSongs,
        now,
        state: resume,
        keepGoing: () => this.inTime(),
      });
      if (!outcome.done) {
        await this.advance({
          ...cp,
          artistIndex: index,
          resolving: { artistIndex: index, state: outcome.state },
        });
        if (outcome.blocked) throw outcome.blocked;
        return;
      }
      songs = outcome.songs;
    }
    // Only a finished resolution reaches the cache: never a truncated pool.
    await this.deps.songsCache.put(artist.artistId, plan.market, songs);
    this.cache?.set(artist.artistId, songs);
    await this.advance({ ...cp, artistIndex: index + 1, resolving: undefined });
  }

  private cache: Map<ArtistId, ArtistSongs> | undefined;

  /** One read per step for every artist's cached songs. */
  private async songs(plan: BuildPlan): Promise<Map<ArtistId, ArtistSongs>> {
    this.cache ??= await this.deps.songsCache.getMany(
      plan.artists.map((a) => a.artistId),
      plan.market,
    );
    return this.cache;
  }

  /** Every artist is cached: budgets with real popularity, picks, D-040 order. No calls. */
  private async finishSelection(
    plan: BuildPlan,
    cp: JobCheckpoint,
    cache: Map<ArtistId, ArtistSongs>,
  ): Promise<void> {
    const budgets = budgetsFor(
      plan,
      plan.artists.map((a) => entryFor(cache, a)?.listeners ?? null),
    );
    const chart = await this.loadChart(plan.market);
    const pick = (i: number, budgetMs: number, alreadyPicked: readonly PickedTrack[]) => {
      const artist = plan.artists[i]!;
      return pickFromSongs({
        artist,
        songs: entryFor(cache, artist)?.songs ?? [],
        providers: entryFor(cache, artist)?.providers,
        chart,
        budgetMs,
        minSongs: Math.min(2, budgets[i]?.songs ?? 1),
        alreadyPicked,
      });
    };
    const budgetMs = budgets.map((b) => (b?.minutes ?? 0) * 60_000);
    const chosen: TrackCandidate[][] = [];
    for (const i of plan.artists.keys()) {
      chosen.push(pick(i, budgetMs[i]!, chosen.flat().map(pickedTrack)));
    }
    this.giveShortfallToHeadliners(plan, budgetMs, chosen, pick);
    const picks = chosen.map((tracks) => tracks.map(pickedTrack));
    const unresolved = [
      ...plan.unmatched,
      ...plan.artists.filter((_, i) => (chosen[i] ?? []).length === 0).map((a) => a.name),
    ];
    const pickedTrackIds = orderPlaylist(
      plan.artists.map((a, i) => ({
        tier: a.tier,
        billingRank: a.billingRank,
        trackIds: (picks[i] ?? []).map((p) => p.id),
      })),
    );
    if (pickedTrackIds.length === 0) {
      await this.advance({ ...cp, artistIndex: plan.artists.length, unresolved });
      await this.fail("We couldn't find songs for this lineup on Spotify.");
      return;
    }
    await this.advance({
      ...cp,
      artistIndex: plan.artists.length,
      picks,
      unresolved,
      stage: "create",
      pickedTrackIds,
    });
  }

  /**
   * D-093: time an artist's songs can't fill (a tiny pool) goes to the headliners, so the
   * playlist still reaches its length. Headliners are re-picked with the extra time, never
   * taking a song another artist already has.
   */
  private giveShortfallToHeadliners(
    plan: BuildPlan,
    budgetMs: number[],
    chosen: TrackCandidate[][],
    pick: (i: number, budgetMs: number, alreadyPicked: readonly PickedTrack[]) => TrackCandidate[],
  ): void {
    const length = (tracks: readonly TrackCandidate[]) =>
      tracks.reduce((sum, t) => sum + (t.durationMs ?? AVG_SONG_MS), 0);
    const shortfall = plan.artists.reduce(
      (sum, _, i) => sum + Math.max(0, budgetMs[i]! - length(chosen[i] ?? [])),
      0,
    );
    const headliners = plan.artists.flatMap((a, i) =>
      a.tier === plan.artists[0]!.tier ? [i] : [],
    );
    if (shortfall < AVG_SONG_MS || headliners.length === 0) return;
    for (const i of headliners) {
      const others = chosen.flatMap((tracks, j) => (j === i ? [] : tracks)).map(pickedTrack);
      chosen[i] = pick(i, budgetMs[i]! + shortfall / headliners.length, others);
    }
  }

  /** D-036: one playlist per event, saved before any item is added; a rebuild reuses it. */
  private async createPlaylist(plan: BuildPlan, cp: JobCheckpoint, publisherId: string) {
    let row = await this.deps.shared.findByEvent(this.job.eventId);
    if (!row) {
      await this.checkLeaseForWrite();
      const created = await this.deps.writer.createPlaylist(publisherId, {
        name: playlistName(plan.title),
        description: playlistDescription(plan.title, this.deps.clock.now()),
        public: true,
      });
      row = await this.deps.shared.saveCreated(this.job.eventId, {
        spotifyPlaylistId: created.id,
        url: created.url,
      });
      if (row.spotifyPlaylistId !== created.id) {
        this.deps.logger.warn(
          { eventId: this.job.eventId, orphan: created.id },
          "another build saved this event's playlist first; the new one is unused",
        );
      }
    } else if (this.deps.writer.updateDetails) {
      // D-085: a refresh keeps the same playlist (URL, followers) but brings its name and
      // description up to date ("· Tixtape", the "Updated" date, data credits).
      await this.checkLeaseForWrite();
      await this.deps.writer.updateDetails(publisherId, row.spotifyPlaylistId, {
        name: playlistName(plan.title),
        description: playlistDescription(plan.title, this.deps.clock.now()),
      });
    }
    await this.advance({
      ...cp,
      stage: "write",
      playlistId: row.spotifyPlaylistId,
      playlistUrl: row.url,
      chunksDone: 0,
      chunkInFlight: null,
    });
  }

  /** Chunk 0 replaces all items, later chunks append (LLD §7.3). */
  private async writeNext(current: JobCheckpoint, publisherId: string): Promise<void> {
    // A step that died while appending may or may not have added that chunk; starting over
    // with "replace" is the only way to be sure there are no duplicates.
    const cp =
      current.chunkInFlight !== null && current.chunkInFlight > 0
        ? { ...current, chunksDone: 0, chunkInFlight: null }
        : current;
    const chunks = chunksOf(cp.pickedTrackIds);
    const playlistId = cp.playlistId;
    if (!playlistId) throw new Error("write stage without a playlist id");
    const index = cp.chunksDone;
    const chunk = chunks[index];
    if (!chunk) return this.finish(cp, publisherId);

    this.checkLeaseTimeForWrite();
    await this.advance({ ...cp, chunkInFlight: index }); // also proves the lease is still ours
    const { snapshotId } =
      index === 0
        ? await this.deps.writer.replaceItems(publisherId, playlistId, chunk)
        : await this.deps.writer.addItems(publisherId, playlistId, chunk);
    await this.advance({ ...cp, chunksDone: index + 1, chunkInFlight: null, snapshotId });
  }

  private async finish(cp: JobCheckpoint, publisherId: string): Promise<void> {
    await this.deps.shared.markBuilt(this.job.eventId, {
      trackIds: cp.pickedTrackIds,
      snapshotId: cp.snapshotId,
      lineupHash: cp.lineupHash,
      at: this.deps.clock.now(),
      optionsVersion: PLAYLIST_ALGORITHM_VERSION,
    });
    await this.fillPreview(cp, publisherId);
    const done: JobCheckpoint = { ...cp, stage: "done" };
    this.cp = done;
    await this.save({
      checkpoint: done,
      stage: "done",
      progress: 100,
      status: cp.unresolved.length > 0 ? "partial" : "succeeded",
    });
  }

  /** "What's inside": the first few songs, read back from Spotify. Best effort, never fails a build. */
  private async fillPreview(cp: JobCheckpoint, publisherId: string): Promise<void> {
    const read = this.deps.writer.readTopItems?.bind(this.deps.writer);
    const save = this.deps.shared.savePreview?.bind(this.deps.shared);
    if (!read || !save || !cp.playlistId) return;
    try {
      await save(this.job.eventId, await read(publisherId, cp.playlistId, PREVIEW_TRACKS));
    } catch {
      // No preview is fine: the playlist itself is done.
    }
  }

  private async blocked(e: SpotifyBlockedError): Promise<BuildProgress> {
    const waitMs = e.resumeAfter.getTime() - this.deps.clock.now().getTime();
    const status = waitMs <= SHORT_PAUSE_MS ? "running" : "paused";
    await this.save({ status, resumeAfter: e.resumeAfter });
    return toProgress(this.job);
  }

  private async fail(message: string): Promise<BuildProgress> {
    await this.save({ status: "failed", error: message, resumeAfter: null });
    return toProgress(this.job);
  }

  private async advance(cp: JobCheckpoint): Promise<void> {
    this.cp = cp;
    await this.save({
      checkpoint: cp,
      stage: cp.stage,
      artistsDone: cp.artistIndex,
      progress: progressFor(cp, this.job.artistsTotal),
    });
  }

  /** Before UNIT_START_LIMIT_MS into the step: new work may start. */
  private inTime(): boolean {
    return this.deps.clock.now().getTime() < this.lastUnitStart;
  }

  /** D-045: a Spotify write starts only while the lease is ours with time left to finish it. */
  private async checkLeaseForWrite(): Promise<void> {
    this.checkLeaseTimeForWrite();
    await this.save({});
  }

  private checkLeaseTimeForWrite(): void {
    const left = this.claimStartedAt + LEASE_MS - this.deps.clock.now().getTime();
    if (left < WRITE_LEASE_MARGIN_MS) throw new LeaseLostError();
  }

  private async save(update: JobUpdate): Promise<void> {
    if (!(await this.deps.jobs.save(this.lease, update))) throw new LeaseLostError();
    this.job = { ...this.job, ...update };
  }

  private checkpoint(): JobCheckpoint {
    if (!this.cp) throw new Error("checkpoint not initialised");
    return this.cp;
  }

  /** The chart is market-wide: fetched at most once per step (the adapter caches it daily). */
  private loadChart(market: string): Promise<ChartEntry[]> {
    this.chart ??= this.deps.trending.chart(market).catch((e: unknown) => {
      if (!(e instanceof UpstreamError)) throw e;
      this.deps.logger.warn({ err: e, market }, "trending signal unavailable");
      return [];
    });
    return this.chart;
  }
}
