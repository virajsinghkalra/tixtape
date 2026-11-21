/**
 * One step of a shared playlist build (P2.2, D-005, D-036). A step claims the job's lease,
 * does at most ~8 s of work in small units, checkpoints after each unit and returns progress.
 * Stages: select (popularity for a few artists per unit, then each artist's pool a few calls
 * per unit, D-065) → create → write (one 100-track chunk per unit).
 */
import type {
  ArtistPopularitySource,
  ChartEntry,
  TrendingSource,
} from "@/application/ports/music-signals";
import type {
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
import { orderPlaylist, pickedTrack } from "@/domain/playlists/selection";
import type { PlaylistJobId, SpotifyTrackId } from "@/domain/shared/ids";
import { NotFoundError, UpstreamError } from "@/lib/errors";
import { UNAVAILABLE_MESSAGE } from "./errors";
import { budgetsFor, planBuild, type BuildPlan } from "./plan";
import { advancePool, pickFromPool, type SignalDeps } from "./pick-artist-tracks";
import { CHUNK_SIZE, progressFor, toProgress, type BuildProgress } from "./progress";
import { getPublisher, type PublisherDeps, type PublisherProblem } from "./publisher";

export const STEP_BUDGET_MS = 8_000;
/**
 * No new unit of work starts after this much of a step (D-005, Lead bug report): a unit is at
 * most a few requests of REQUEST_TIMEOUT_MS, so the step ends near STEP_BUDGET_MS.
 */
export const UNIT_START_LIMIT_MS = 6_000;
/** Artists whose Last.fm popularity is looked up per unit of work (D-065). */
export const POPULARITY_CHUNK = 5;
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

export type BuildDeps = SignalDeps &
  PublisherDeps & {
    jobs: PlaylistJobRepository;
    shared: SharedPlaylistRepository;
    events: EventLineupReader;
    trending: TrendingSource;
    writer: PlaylistWriter;
    popularity: ArtistPopularitySource;
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
    popularity: [],
    pool: null,
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

  private async selectNext(plan: BuildPlan, cp: JobCheckpoint): Promise<void> {
    if (cp.popularity.length < plan.artists.length) return this.lookUpPopularity(plan, cp);
    const artist = plan.artists[cp.artistIndex];
    if (!artist) return this.finishSelection(plan, cp);
    const budget = budgetsFor(plan, cp.popularity)[cp.artistIndex];
    const targetSongs = budget?.songs ?? 1;
    const pool = await advancePool(
      this.deps,
      {
        artist,
        market: plan.market,
        targetSongs,
        chart: () => this.loadChart(plan.market),
        keepGoing: () => this.inTime(),
      },
      cp.pool,
    );
    if (pool.phase !== "ready") return this.advance({ ...cp, pool });

    const tracks = pickFromPool({
      artist,
      pool,
      budgetMs: (budget?.minutes ?? 0) * 60_000,
      minSongs: Math.min(2, targetSongs),
      alreadyPicked: cp.picks.flat(),
    });
    await this.advance({
      ...cp,
      pool: null,
      artistIndex: cp.artistIndex + 1,
      picks: [...cp.picks, tracks.map(pickedTrack)],
      unresolved: tracks.length > 0 ? cp.unresolved : [...cp.unresolved, artist.name],
    });
  }

  /** D-065: Last.fm listeners for the next few artists; a failure means "unknown" (1.0). */
  private async lookUpPopularity(plan: BuildPlan, cp: JobCheckpoint): Promise<void> {
    const next = plan.artists.slice(cp.popularity.length, cp.popularity.length + POPULARITY_CHUNK);
    const found: (number | null)[] = [];
    for (const artist of next) {
      if (found.length > 0 && !this.inTime()) break;
      found.push(
        await this.deps.popularity.listeners(artist.name).catch((e: unknown) => {
          if (!(e instanceof UpstreamError)) throw e;
          this.deps.logger.warn({ err: e, artist: artist.name }, "popularity unavailable");
          return null;
        }),
      );
    }
    await this.advance({ ...cp, popularity: [...cp.popularity, ...found] });
  }

  private async finishSelection(plan: BuildPlan, cp: JobCheckpoint): Promise<void> {
    const pickedTrackIds = orderPlaylist(
      plan.artists.map((a, i) => ({
        tier: a.tier,
        billingRank: a.billingRank,
        trackIds: (cp.picks[i] ?? []).map((p) => p.id),
      })),
    );
    if (pickedTrackIds.length === 0) {
      await this.fail("We couldn't find songs for this lineup on Spotify.");
      return;
    }
    await this.advance({ ...cp, stage: "create", pickedTrackIds });
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
    if (!chunk) return this.finish(cp);

    this.checkLeaseTimeForWrite();
    await this.advance({ ...cp, chunkInFlight: index }); // also proves the lease is still ours
    const { snapshotId } =
      index === 0
        ? await this.deps.writer.replaceItems(publisherId, playlistId, chunk)
        : await this.deps.writer.addItems(publisherId, playlistId, chunk);
    await this.advance({ ...cp, chunksDone: index + 1, chunkInFlight: null, snapshotId });
  }

  private async finish(cp: JobCheckpoint): Promise<void> {
    await this.deps.shared.markBuilt(this.job.eventId, {
      trackIds: cp.pickedTrackIds,
      snapshotId: cp.snapshotId,
      lineupHash: cp.lineupHash,
      at: this.deps.clock.now(),
    });
    const done: JobCheckpoint = { ...cp, stage: "done" };
    this.cp = done;
    await this.save({
      checkpoint: done,
      stage: "done",
      progress: 100,
      status: cp.unresolved.length > 0 ? "partial" : "succeeded",
    });
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
