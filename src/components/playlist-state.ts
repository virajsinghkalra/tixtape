/**
 * Maps the shared-playlist API (D-036, D-048 §D) to what the panel shows. Pure and tested.
 * GET  /api/events/:id/playlist    → none | building | ready (+ stale, builtAt)
 * POST /api/events/:id/playlist    → 200 ready · 202 building · 422 · 429 · 503
 * POST /api/playlist-jobs/:id/step → progress {status, stage, progress, artistsDone, artistsTotal,
 *                                     unresolved[], resumeAfter?, playlistUrl?, error?}
 */
import { z } from "zod";
import { PLAYLIST_SOON } from "./lineup-copy";

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
const SLOW = "Still cooking 🍳 Check back soon.";

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
  z.object({
    status: z.literal("building"),
    jobId: z.string(),
    url: z.string().url().optional(),
    /** The job's current progress, when the server includes it (paused, stage, counts). */
    progress: z.lazy(() => stepBody).optional(),
  }),
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

export const JOINING_LABEL = "Joining…";

const GENERIC = "Oops. Try again.";

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
    const joining: PlaylistView = {
      kind: "building",
      joined: true,
      jobId: d.jobId,
      progress: 0,
      label: JOINING_LABEL,
      waitUntil: null,
      stalled: 0,
    };
    if (!d.progress) return joining;
    // Known progress (e.g. paused until 6:40 pm) shows straight away, not "Joining…".
    const known = viewFromStep(d.progress, joining);
    return known.kind === "building" ? { ...known, joined: true } : known;
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
    return { kind: "problem", message: PLAYLIST_SOON };
  }
  if (httpStatus === 429) {
    const secs = Number(retryAfter);
    const wait = Number.isFinite(secs) && secs > 0 ? `${Math.ceil(secs / 60)} min` : "a minute";
    return {
      kind: "problem",
      message: `Busy. Retry in ${wait}.`,
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
    label: "Matching…",
    waitUntil: null,
    stalled: 0,
  };
}

/** One step of a build. `previous` decides whether this was a first build or a refresh. */
export function viewFromStep(
  body: unknown,
  previous: PlaylistView,
  httpStatus = 200,
  now: Date = new Date(),
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
    return refreshing ? { ...previous, refresh: null } : { kind: "problem", message: GENERIC };
  }
  const label = stageLabel(p);
  // QA-F-19: a Spotify 429 is a pause whatever the job status says. Short waits (≤ 30 s) keep the
  // job "running" with a `resumeAfter`, so any resume time still ahead reads "Paused · back at".
  const waitUntil =
    p.resumeAfter && (p.status === "paused" || new Date(p.resumeAfter).getTime() > now.getTime())
      ? p.resumeAfter
      : null;
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

/** D-082 tiny labels: "Matching…" → "Picking songs…" → "Creating…" → "Adding songs…". */
export function stageLabel(p: {
  status: string;
  stage?: string | null;
  progress: number;
  artistsDone: number;
  artistsTotal: number;
}): string {
  if (p.status === "queued" || !p.stage) return "Matching…";
  switch (p.stage) {
    case "select":
      return "Picking songs…";
    case "create":
      return "Creating…";
    case "write":
      return "Adding songs…";
    default:
      return "Finishing…";
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
  // Just joined with nothing known yet: ask at once, so a pause shows without a wait.
  if (job.label === JOINING_LABEL && !job.waitUntil) return 0;
  if (!job.waitUntil) return STEP_MS;
  return Math.max(STEP_MS, new Date(job.waitUntil).getTime() - now.getTime());
}

const TIME = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kolkata",
});

/** "6:40 pm" in IST. */
export function formatClock(iso: string): string {
  return TIME.format(new Date(iso)).toLowerCase();
}

/**
 * A client status refresh without job progress must not replace what we already know about the
 * same job (e.g. a server-rendered pause) with "Joining…".
 */
export function refreshView(current: PlaylistView, next: PlaylistView): PlaylistView {
  const known = activeJob(current);
  if (
    next.kind === "building" &&
    next.label === JOINING_LABEL &&
    known &&
    known.jobId === next.jobId
  ) {
    return current;
  }
  return next;
}

/** After a failed step: keep the view, but leave "Joining…" so the retry waits ~1.5 s. */
export function afterFailedStep(view: PlaylistView): PlaylistView {
  if (view.kind === "building" && view.label === JOINING_LABEL) {
    return { ...view, label: "Checking…" };
  }
  return { ...view };
}
