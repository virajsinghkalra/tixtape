/**
 * Scheduled sweep (P4.1), every 30 minutes from GitHub Actions.
 *
 *   npx tsx src/scripts/sweep.ts
 *
 * 1. Steps shared playlist jobs left behind when the browser closed (D-005, D-043): the
 *    repository's `listDue` (active, `resume_after` passed, not leased, idle for 2 minutes).
 *    A job whose event is held or archived can never finish, so it is cancelled.
 *    Work goes through the Playlist Engine's `step` use case, so leases and budgets apply.
 * 2. Housekeeping: archives past events (D-060), deletes collector candidates not seen for
 *    30 days (D-060), search logs older than 90 days (D-047), expired sessions and rate-limit
 *    windows older than a day (D-070), and analytics events older than 180 days with the idle
 *    anonymous devices they leave behind (D-090).
 *    The scheduled ingest runs in candidates-only mode (D-055), which does neither archiving
 *    nor candidate cleanup, so the sweep owns them.
 * 3. Alerts (D-060): held events waiting for review, and a publisher that needs reauth.
 * 4. D-074 spike guard: over 30 auto-published events in 24 h pauses auto-publish and alerts.
 *
 * Each task runs on its own; a failure is logged, the rest still run, and the exit code is 1.
 */
import "dotenv/config";
import { AdminListEventsQuerySchema, ListEventsQuerySchema } from "@/application/events";
import {
  PLAYLIST_ALGORITHM_VERSION,
  PlaylistUnavailableError,
  type BuildProgress,
} from "@/application/playlists";
import { ACTIVE_JOB_STATUSES } from "@/application/ports/playlists";
import type { PlaylistJobId } from "@/domain/shared/ids";
import { ThrottledAlerts } from "@/infrastructure/alerts";
import { AUTO_PUBLISH_SPIKE_LIMIT, countAutoPublished } from "@/infrastructure/alerts/gig-digest";
import { PgAnalyticsStore } from "@/infrastructure/db/analytics-store";
import { PgAutoPublishPause } from "@/infrastructure/db/auto-publish-pause";
import { deleteExpiredRateLimits } from "@/infrastructure/db/pg-rate-limiter";
import { PgPlaylistJobRepository } from "@/infrastructure/db/playlist-job-repository";
import { listStaleSharedPlaylists } from "@/infrastructure/db/shared-playlist-repository";
import { FileCollectorState } from "@/infrastructure/sources/collector-state";
import { runAsSpotifyClass } from "@/infrastructure/spotify";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { container } from "@/server/container";
import { events } from "@/server/events";
import { playlists } from "@/server/playlists";

const DAY_MS = 86_400_000;
const CANDIDATE_TTL_MS = 30 * DAY_MS;
/** D-090: raw analytics events are kept 180 days. */
const ANALYTICS_TTL_MS = 180 * DAY_MS;
const MAX_JOBS = 20;
/** Leaves headroom inside the workflow's 25-minute timeout. */
const BUDGET_MS = 20 * 60_000;
/** Like the browser (D-005): a short pause between steps. */
const STEP_GAP_MS = 1_500;
/** Waits up to this long for a short Spotify pause; longer ones resume on a later sweep. */
const MAX_INLINE_WAIT_MS = 15_000;
/** Steps that change nothing (another worker holds the lease) before moving on. */
const MAX_IDLE_STEPS = 5;
const ALERT_STATE = "node_modules/.cache/lineupmixes/alerts-sweep.json";

const line = (s: string) => console.warn(s);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let failed = false;

async function task(name: string, run: () => Promise<string>): Promise<void> {
  try {
    line(`${name}: ${await run()}`);
  } catch (e) {
    failed = true;
    container().logger.error({ err: e, task: name }, "sweep task failed");
    line(`${name}: FAILED (${e instanceof Error ? e.message : String(e)})`);
  }
}

const isActive = (p: BuildProgress) =>
  (ACTIVE_JOB_STATUSES as readonly string[]).includes(p.status);
const fingerprint = (p: BuildProgress) =>
  `${p.status}|${p.stage}|${p.progress}|${p.artistsDone}|${p.resumeAfter?.getTime() ?? ""}`;

/** Steps one job until it finishes, pauses for long, stops progressing, or time runs out. */
async function driveJob(jobId: PlaylistJobId, deadline: number): Promise<string> {
  const { clock } = container();
  let last = "";
  let idle = 0;
  let p: BuildProgress | undefined;
  while (clock.now().getTime() < deadline) {
    p = await playlists().step(jobId);
    if (!isActive(p)) return p.status;
    const wait = p.resumeAfter ? p.resumeAfter.getTime() - clock.now().getTime() : 0;
    if (wait > MAX_INLINE_WAIT_MS) return `paused until ${p.resumeAfter!.toISOString()}`;
    idle = fingerprint(p) === last ? idle + 1 : 0;
    if (idle >= MAX_IDLE_STEPS) return `no progress (${p.status}, ${p.progress}%)`;
    last = fingerprint(p);
    await sleep(Math.max(wait, STEP_GAP_MS));
  }
  return `out of time at ${p?.progress ?? 0}%`;
}

const UNLISTED_REASON = "This event is no longer listed, so its playlist build was stopped.";

async function cancelUnlisted(id: PlaylistJobId): Promise<string> {
  try {
    await container().adminConsole.cancelJob(id, { reason: UNLISTED_REASON });
    return "cancelled: event not published";
  } catch (e) {
    // It finished in the meantime: nothing to cancel.
    if (e instanceof ConflictError) return "already finished";
    throw e;
  }
}

async function stepAbandonedJobs(): Promise<string> {
  const deadline = container().clock.now().getTime() + BUDGET_MS;
  const due = await new PgPlaylistJobRepository(container().db).listDue(
    container().clock.now(),
    MAX_JOBS,
  );
  const ids = due.map((j) => j.id);
  const outcomes: string[] = [];
  for (const id of ids) {
    if (container().clock.now().getTime() >= deadline) break;
    try {
      outcomes.push(`${id} → ${await driveJob(id, deadline)}`);
    } catch (e) {
      // A job whose event is held or archived 404s (D-058). It can never finish, so cancel it
      // instead of retrying it on every sweep.
      if (e instanceof NotFoundError) {
        outcomes.push(`${id} → ${await cancelUnlisted(id)}`);
        continue;
      }
      failed = true;
      outcomes.push(`${id} → error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return ids.length === 0 ? "no abandoned jobs" : `\n  ${outcomes.join("\n  ")}`;
}

async function alertHeldEvents(alerts: ThrottledAlerts): Promise<string> {
  const now = container().clock.now();
  const page = await events().listAdminEvents(
    AdminListEventsQuerySchema.parse({
      visibility: "held",
      from: now.toISOString(),
      pageSize: 100,
    }),
  );
  if (page.total === 0) return "none held";
  const list = page.items.map((e) => `- ${e.title} (${e.startsAt.toISOString().slice(0, 10)})`);
  await alerts.send({
    key: "held-events",
    subject: `${page.total} upcoming event(s) held for review`,
    body: `These events are held until the Lead reviews them (D-055, D-056):\n\n${list.join("\n")}\n\nReview with: npx tsx src/scripts/ingest.ts --dry-run, then --publish <eventId>.`,
  });
  return `${page.total} held (alert sent unless unchanged today)`;
}

async function alertPublisher(alerts: ThrottledAlerts): Promise<string> {
  const status = await playlists().getPublisherStatus();
  if (!status.connected) return "publisher not connected yet (no alert)";
  if (!status.needsReauth) return "publisher ok";
  await alerts.send({
    key: "publisher-reauth",
    severity: "action",
    subject: "The playlist publisher must sign in to Spotify again",
    body: `Shared playlists can't be built or updated until the publisher account${status.displayName ? ` (${status.displayName})` : ""} reconnects. Sign in at /api/auth/spotify/login as that account, then POST /api/admin/publisher. See docs/DEPLOY.md.`,
  });
  return "publisher needs reauth (alert sent unless unchanged today)";
}

/**
 * D-074 safety valve: more than 30 auto-published events in 24 h pauses auto-publish for 24 h
 * (the Gig Coverage script checks the flag) and alerts. An existing pause isn't extended.
 */
async function guardAutoPublishSpike(alerts: ThrottledAlerts): Promise<string> {
  const c = container();
  const now = c.clock.now();
  const count = await countAutoPublished(c.db, new Date(now.getTime() - DAY_MS));
  if (count <= AUTO_PUBLISH_SPIKE_LIMIT) return `${count} auto-published in 24 h (ok)`;
  const pause = new PgAutoPublishPause(c.db);
  const already = await pause.pausedUntil(now);
  const until = already ?? new Date(now.getTime() + DAY_MS);
  if (!already) {
    await pause.pauseUntil(
      until,
      `spike: ${count} auto-published in 24 h (limit ${AUTO_PUBLISH_SPIKE_LIMIT})`,
    );
  }
  await alerts.send({
    key: "auto-publish-spike",
    severity: "action",
    subject: `Auto-publish paused: ${count} events published in 24 h`,
    body: `The auto-gate published ${count} events in the last 24 hours, above the limit of ${AUTO_PUBLISH_SPIKE_LIMIT}. Auto-publish is paused until ${until.toISOString()} (settings key auto_publish_paused_until); nights are still discovered and judged, and held for review.\n\nCheck the recent publish_audit entries. To resume early, delete that settings row. To stop auto-publish entirely, set the repository variable AUTO_PUBLISH_ENABLED to false.`,
  });
  return `${count} auto-published in 24 h: SPIKE, paused until ${until.toISOString()}`;
}

/** D-085: stale shared playlists (older algorithm or lineup) refreshed per sweep. */
const MAX_REFRESHES = 5;

/**
 * D-085: starts a rebuild for stale shared playlists, into the same Spotify playlist. The
 * "playlist jobs" task right after steps them (as the engine's `build` class, D-080 budget).
 * Unpublished events are skipped (404), and the start limit (key "sweep") caps the rate.
 */
async function refreshStalePlaylists(): Promise<string> {
  const c = container();
  const ids = await listStaleSharedPlaylists(c.db, {
    currentVersion: PLAYLIST_ALGORITHM_VERSION,
    now: c.clock.now(),
    limit: MAX_REFRESHES,
  });
  let started = 0;
  for (const id of ids) {
    try {
      const r = await playlists().startSharedBuild(id, "sweep");
      if (r.status === "building") started++;
    } catch (e) {
      // No publisher connected (or it needs reauth): nothing can be rebuilt yet. The publisher
      // task alerts about that once a day; this task must not fail every hourly run.
      if (e instanceof PlaylistUnavailableError)
        return `${ids.length} stale, skipped: no publisher`;
      if (e instanceof NotFoundError || (e instanceof AppError && e.httpStatus < 500)) continue;
      throw e;
    }
  }
  return `${ids.length} stale, ${started} rebuilding`;
}

/** D-080: how long one sweep may spend warming the playlist song cache. */
const PREWARM_BUDGET_MS = 4 * 60_000;

/**
 * D-080: warms the song cache for upcoming published events, soonest first, as the `prewarm`
 * Spotify class (≤ 1 call per 10 s, daily cap), so "Make playlist" only has to write.
 */
async function prewarmPlaylists(): Promise<string> {
  const c = container();
  const deadline = new Date(c.clock.now().getTime() + PREWARM_BUDGET_MS);
  const page = await events().listEvents(
    ListEventsQuerySchema.parse({ from: c.clock.now().toISOString(), pageSize: 100 }),
  );
  let resolved = 0;
  let remaining = 0;
  for (const e of page.items) {
    if (c.clock.now() >= deadline) break;
    const r = await runAsSpotifyClass("prewarm", () =>
      playlists().prewarmEvent(e.id, { deadline }),
    );
    resolved += r.resolved;
    remaining += r.remaining;
    if (r.stoppedUntil)
      return `${resolved} artists warmed; paused until ${r.stoppedUntil.toISOString()}`;
  }
  return `${resolved} artists warmed, ${remaining} still cold`;
}

/** D-080: Spotify calls and 429s per class, today and yesterday (UTC). */
async function spotifyCallStats(): Promise<string> {
  const c = container();
  const today = await c.spotifyBudget.stats(c.clock.now());
  const yesterday = await c.spotifyBudget.stats(new Date(c.clock.now().getTime() - DAY_MS));
  const fmt = (s: typeof today) =>
    Object.entries(s)
      .map(([cls, v]) => `${cls} ${v.calls}${v.rateLimited ? ` (429×${v.rateLimited})` : ""}`)
      .join(", ");
  c.logger.info({ today, yesterday }, "spotify calls per class");
  return `today: ${fmt(today)} | yesterday: ${fmt(yesterday)}`;
}

async function main(): Promise<void> {
  const c = container();
  const now = c.clock.now();
  const alerts = new ThrottledAlerts(c.alerts, ALERT_STATE, c.clock);
  const { verification, candidates } = events().collectorServices(new FileCollectorState());
  line(`Sweep ${now.toISOString()}`);

  await task("stale playlists", refreshStalePlaylists);
  await task("playlist jobs", stepAbandonedJobs);
  await task("archive past events", async () => `${await verification.archivePast(now)} archived`);
  await task("stale candidates", async () => {
    const n = await candidates.deleteStale(new Date(now.getTime() - CANDIDATE_TTL_MS));
    return `${n} deleted`;
  });
  await task("search log", async () => `${await events().pruneSearchLog()} deleted`);
  // QA-F-7: trending comes from the anonymous analytics (event opens, search click-throughs,
  // playlist opens); recomputed each run, so it's idempotent.
  await task("event stats", async () => `${(await events().rollupEventStats()).events} events`);
  await task("sessions", async () => `${await c.spotify.sessions.deleteExpired(now)} expired`);
  await task("rate limits", async () => {
    const n = await deleteExpiredRateLimits(c.db, new Date(now.getTime() - DAY_MS));
    return `${n} old windows deleted`;
  });
  await task("analytics retention", async () => {
    const r = await new PgAnalyticsStore(c.db).prune(new Date(now.getTime() - ANALYTICS_TTL_MS));
    return `${r.events} events, ${r.devices} idle devices deleted`;
  });
  await task("held events", () => alertHeldEvents(alerts));
  await task("auto-publish spike", () => guardAutoPublishSpike(alerts));
  await task("publisher", () => alertPublisher(alerts));
  await task("playlist prewarm", prewarmPlaylists);
  await task("spotify calls", spotifyCallStats);

  await c.db.$close();
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
