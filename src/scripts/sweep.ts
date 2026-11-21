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
 *    windows older than a day (D-070).
 *    The scheduled ingest runs in candidates-only mode (D-055), which does neither archiving
 *    nor candidate cleanup, so the sweep owns them.
 * 3. Alerts (D-060): held events waiting for review, and a publisher that needs reauth.
 * 4. D-074 spike guard: over 30 auto-published events in 24 h pauses auto-publish and alerts.
 *
 * Each task runs on its own; a failure is logged, the rest still run, and the exit code is 1.
 */
import "dotenv/config";
import { AdminListEventsQuerySchema } from "@/application/events";
import type { BuildProgress } from "@/application/playlists";
import { ACTIVE_JOB_STATUSES } from "@/application/ports/playlists";
import type { PlaylistJobId } from "@/domain/shared/ids";
import { ThrottledAlerts } from "@/infrastructure/alerts";
import { AUTO_PUBLISH_SPIKE_LIMIT, countAutoPublished } from "@/infrastructure/alerts/gig-digest";
import { PgAutoPublishPause } from "@/infrastructure/db/auto-publish-pause";
import { deleteExpiredRateLimits } from "@/infrastructure/db/pg-rate-limiter";
import { PgPlaylistJobRepository } from "@/infrastructure/db/playlist-job-repository";
import { FileCollectorState } from "@/infrastructure/sources/collector-state";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { container } from "@/server/container";
import { events } from "@/server/events";
import { playlists } from "@/server/playlists";

const DAY_MS = 86_400_000;
const CANDIDATE_TTL_MS = 30 * DAY_MS;
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
    subject: `Auto-publish paused: ${count} events published in 24 h`,
    body: `The auto-gate published ${count} events in the last 24 hours, above the limit of ${AUTO_PUBLISH_SPIKE_LIMIT}. Auto-publish is paused until ${until.toISOString()} (settings key auto_publish_paused_until); nights are still discovered and judged, and held for review.\n\nCheck the recent publish_audit entries. To resume early, delete that settings row. To stop auto-publish entirely, set the repository variable AUTO_PUBLISH_ENABLED to false.`,
  });
  return `${count} auto-published in 24 h: SPIKE, paused until ${until.toISOString()}`;
}

async function main(): Promise<void> {
  const c = container();
  const now = c.clock.now();
  const alerts = new ThrottledAlerts(c.alerts, ALERT_STATE, c.clock);
  const { verification, candidates } = events().collectorServices(new FileCollectorState());
  line(`Sweep ${now.toISOString()}`);

  await task("playlist jobs", stepAbandonedJobs);
  await task("archive past events", async () => `${await verification.archivePast(now)} archived`);
  await task("stale candidates", async () => {
    const n = await candidates.deleteStale(new Date(now.getTime() - CANDIDATE_TTL_MS));
    return `${n} deleted`;
  });
  await task("search log", async () => `${await events().pruneSearchLog()} deleted`);
  await task("sessions", async () => `${await c.spotify.sessions.deleteExpired(now)} expired`);
  await task("rate limits", async () => {
    const n = await deleteExpiredRateLimits(c.db, new Date(now.getTime() - DAY_MS));
    return `${n} old windows deleted`;
  });
  await task("held events", () => alertHeldEvents(alerts));
  await task("auto-publish spike", () => guardAutoPublishSpike(alerts));
  await task("publisher", () => alertPublisher(alerts));

  await c.db.$close();
  if (failed) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
