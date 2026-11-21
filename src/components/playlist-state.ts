/**
 * Maps the shared-playlist API (D-036, D-048 §D) to what the panel shows. Pure and tested.
 * GET  /api/events/:id/playlist    → none | building | ready (+ stale, builtAt)
 * POST /api/events/:id/playlist    → 200 ready · 202 building · 422 · 429 · 503
 * POST /api/playlist-jobs/:id/step → progress {status, stage, progress, artistsDone, artistsTotal,
 *                                     unresolved[], resumeAfter?, playlistUrl?, error?}
 */
import { z } from "zod";

export type BuildProgress = {
  jobId: string;
  progress: number;
  label: string;
  /** Set while Spotify asked us to wait. */
  waitUntil: string | null;
  /** Steps in a row with no visible progress; too many ends the wait (never an endless spinner). */
  stalled: number;
};

/** About 12 s of identical steps (8 × 1.5 s): stop polling and say so. */
export const MAX_STALLED_STEPS = 8;
const SLOW =
  "This is taking longer than usual. It keeps building in the background, so check back in a few minutes.";

export type PlaylistView =
  /** Status not known yet: show a quiet placeholder, never a "Make playlist" button. */
  | { kind: "checking" }
  | { kind: "idle" }
  | { kind: "starting" }
  /** `joined`: someone else started it; we follow the same job (no duplicate build). */
  | ({ kind: "building"; joined: boolean } & BuildProgress)
  | {
      kind: "ready";
      url: string;
      builtAt: string | null;
      justMade: boolean;
      /** Artists with no songs (not on Spotify): the playlist is partial. */
      skipped: string[];
      /** The lineup changed: a rebuild into the same playlist is running or about to. */
      refresh: BuildProgress | "pending" | null;
    }
  | { kind: "unavailable" }
  | { kind: "problem"; message: string };

const statusBody = z.discriminatedUnion("status", [
  z.object({ status: z.literal("none") }),
  z.object({ status: z.literal("building"), jobId: z.string(), url: z.string().url().optional() }),
  z.object({
    status: z.literal("ready"),
    url: z.string().url(),
    builtAt: z.string().optional(),
    stale: z.boolean().optional(),
  }),
]);
const startBody = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), url: z.string().url() }),
  z.object({ status: z.literal("building"), jobId: z.string() }),
]);
const stepBody = z.object({
  jobId: z.string(),
  status: z.enum(["queued", "running", "paused", "succeeded", "partial", "failed"]),
  stage: z.enum(["select", "create", "write", "done"]).nullable().optional(),
  progress: z.number().min(0).max(100),
  artistsDone: z.number().int().min(0).default(0),
  artistsTotal: z.number().int().min(0).default(0),
  unresolved: z.array(z.string()).default([]),
  resumeAfter: z.string().optional(),
  playlistUrl: z.string().url().optional(),
  error: z.string().optional(),
});

const GENERIC = "Something went wrong making the playlist. Try again in a minute.";

const ready = (
  url: string,
  extra: Partial<Extract<PlaylistView, { kind: "ready" }>> = {},
): PlaylistView => ({
  kind: "ready",
  url,
  builtAt: null,
  justMade: false,
  skipped: [],
  refresh: null,
  ...extra,
});

/** What the event already has. Anything unexpected reads as "no playlist yet". */
export function viewFromStatus(body: unknown): PlaylistView {
  const parsed = statusBody.safeParse(body);
  if (!parsed.success || parsed.data.status === "none") return { kind: "idle" };
  const d = parsed.data;
  if (d.status === "building") {
    return {
      kind: "building",
      joined: true,
      jobId: d.jobId,
      progress: 0,
      label: "Joining the build…",
      waitUntil: null,
      stalled: 0,
    };
  }
  return ready(d.url, { builtAt: d.builtAt ?? null, refresh: d.stale ? "pending" : null });
}

export function viewFromStart(
  httpStatus: number,
  body: unknown,
  retryAfter: string | null,
): PlaylistView {
  if (httpStatus === 503) return { kind: "unavailable" };
  if (httpStatus === 422) {
    return {
      kind: "problem",
      message:
        "None of these artists are on Spotify yet, so there's nothing to add. Check back soon.",
    };
  }
  if (httpStatus === 429) {
    const secs = Number(retryAfter);
    const wait = Number.isFinite(secs) && secs > 0 ? `${Math.ceil(secs / 60)} min` : "a minute";
    return {
      kind: "problem",
      message: `Lots of playlists being made right now. Try again in ${wait}.`,
    };
  }
  const parsed = startBody.safeParse(body);
  if (httpStatus >= 300 || !parsed.success) return { kind: "problem", message: GENERIC };
  if (parsed.data.status === "ready") return ready(parsed.data.url, { justMade: true });
  return {
    kind: "building",
    joined: false,
    jobId: parsed.data.jobId,
    progress: 0,
    label: "Matching artists…",
    waitUntil: null,
    stalled: 0,
  };
}

/** One step of a build. `previous` decides whether this was a first build or a refresh. */
export function viewFromStep(
  body: unknown,
  previous: PlaylistView,
  httpStatus = 200,
): PlaylistView {
  if (httpStatus === 503) return { kind: "unavailable" };
  const parsed = stepBody.safeParse(body);
  if (!parsed.success) return { kind: "problem", message: GENERIC };
  const p = parsed.data;
  const refreshing = previous.kind === "ready";
  if ((p.status === "succeeded" || p.status === "partial") && p.playlistUrl) {
    return ready(p.playlistUrl, {
      justMade: !refreshing,
      builtAt: new Date().toISOString(),
      skipped: p.status === "partial" ? p.unresolved : [],
    });
  }
  if (p.status === "failed") {
    return refreshing
      ? { ...previous, refresh: null }
      : { kind: "problem", message: p.error ?? GENERIC };
  }
  const label = stageLabel(p);
  const waitUntil = p.status === "paused" ? (p.resumeAfter ?? null) : null;
  const before = activeJob(previous);
  const same = before !== null && before.progress === p.progress && before.label === label;
  // A Spotify pause is a known wait, not a stall.
  const stalled = !waitUntil && same ? before.stalled + 1 : 0;
  if (stalled >= MAX_STALLED_STEPS) {
    return refreshing ? { ...previous, refresh: null } : { kind: "problem", message: SLOW };
  }
  const progress: BuildProgress = {
    jobId: p.jobId,
    progress: p.progress,
    label,
    waitUntil,
    stalled,
  };
  if (refreshing) return { ...previous, refresh: progress };
  return { kind: "building", joined: previous.kind === "building" && previous.joined, ...progress };
}

/** "Matching artists" → "Picking songs 8/13" → "Creating playlist" → "Adding songs 92%". */
export function stageLabel(p: {
  status: string;
  stage?: string | null;
  progress: number;
  artistsDone: number;
  artistsTotal: number;
}): string {
  if (p.status === "queued" || !p.stage) return "Matching artists…";
  switch (p.stage) {
    case "select":
      return p.artistsTotal > 0
        ? `Picking songs · ${p.artistsDone}/${p.artistsTotal} artists`
        : "Picking songs…";
    case "create":
      return "Creating the playlist…";
    case "write":
      return `Adding songs · ${p.progress}%`;
    default:
      return "Finishing up…";
  }
}

/** The job being stepped, if any. */
export function activeJob(view: PlaylistView): BuildProgress | null {
  if (view.kind === "building") return view;
  if (view.kind === "ready" && view.refresh && view.refresh !== "pending") return view.refresh;
  return null;
}

/** How long to wait before the next step call: ~1.5s, or until Spotify said to resume. */
export function nextStepDelay(job: BuildProgress, now: Date): number {
  const STEP_MS = 1500;
  if (!job.waitUntil) return STEP_MS;
  return Math.max(STEP_MS, new Date(job.waitUntil).getTime() - now.getTime());
}

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kolkata",
});

/** "6:40 pm" in IST. */
export function formatClock(iso: string): string {
  return TIME.format(new Date(iso)).toLowerCase();
}

/** "21 Nov" in IST. */
export function formatDay(iso: string): string {
  return DAY.format(new Date(iso));
}
