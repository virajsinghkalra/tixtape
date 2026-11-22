"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { track } from "./analytics/track";
import { valueMoment } from "./identity/value-moment";
import { previewPending, type PlaylistPreview } from "./playlist-preview";
import {
  activeJob,
  afterFailedStep,
  refreshView,
  formatClock,
  isVisiblePause,
  nextStepDelay,
  viewFromStart,
  viewFromStatus,
  viewFromStep,
  type BuildProgress,
  type PlaylistView,
} from "./playlist-state";
import { PLAYLIST_SOON } from "./lineup-copy";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { Button } from "./ui/Button";
import { Confetti } from "./ui/Confetti";
import { EASE_OUT_EXPO } from "./ui/motion";
import { haptic } from "./ui/feedback";

type Props = {
  eventId: string;
  /** UX #5: secondary actions under the primary button (other teams can add one-line inserts). */
  actions?: ReactNode;
  /** Status rendered on the server (GET /api/events/:id/playlist shape); null = unknown. */
  initialStatus?: unknown;
  /** The engine's plan (D-065): only used to tell "nothing to make yet" (no counts shown). */
  preview: PlaylistPreview | null;
  matched: number;
  total: number;
};

/**
 * The event's one shared playlist (D-036, D-048 §D), made by the Tixtape account. D-082 minimal
 * copy: a title, the button, and the state in a few words. States: ready, none → live staged progress → confetti, building (join), stale
 * (auto-refresh), partial, paused and unavailable. Steps the job about every 1.5s.
 */
export function PlaylistPanel({ eventId, actions, preview, matched, total, initialStatus }: Props) {
  const [view, setView] = useState<PlaylistView>(() =>
    initialStatus ? viewFromStatus(initialStatus) : { kind: "checking" },
  );
  // Nothing matched yet (or a 0-song estimate): never "0 songs · 0 min", no "Make playlist".
  // QA-F-20: a ready (or building) playlist is never "Playlist soon".
  const pending =
    previewPending(preview, matched, total) &&
    view.kind !== "ready" &&
    view.kind !== "building" &&
    view.kind !== "starting";
  const viewRef = useRef(view);
  viewRef.current = view;
  const alive = useRef(true);
  // Set true on every mount: React Strict Mode mounts, unmounts and re-mounts in dev, and a
  // flag left false would silently drop every update (the "stuck on Starting…" bug).
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const apply = useCallback((next: PlaylistView) => alive.current && setView(next), []);

  const start = useCallback(async () => {
    const refreshing = viewRef.current.kind === "ready";
    if (!refreshing) {
      setView({ kind: "starting" });
      track("playlist_make", { eventId });
    }
    try {
      const res = await fetch(`/api/events/${eventId}/playlist`, { method: "POST" });
      const body: unknown = await res.json().catch(() => null);
      const next = viewFromStart(res.status, body, res.headers.get("Retry-After"));
      const current = viewRef.current;
      // A stale refresh keeps the playlist open and shows the rebuild underneath.
      if (refreshing && current.kind === "ready") {
        apply({ ...current, refresh: next.kind === "building" ? next : null });
      } else apply(next);
    } catch {
      apply(
        refreshing
          ? viewRef.current
          : { kind: "problem", message: "Lost the connection. Try again." },
      );
    }
  }, [eventId, apply]);

  // What the event already has: ready, a build to join, or nothing yet.
  useEffect(() => {
    fetch(`/api/events/${eventId}/playlist`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body) apply(refreshView(viewRef.current, viewFromStatus(body)));
        else if (viewRef.current.kind === "checking") apply({ kind: "idle" });
      })
      .catch(() => {
        if (viewRef.current.kind === "checking") apply({ kind: "idle" });
      });
  }, [eventId, apply]);

  // UX #9: a success tick the moment a first build lands (with the confetti).
  const justMade = view.kind === "ready" && view.justMade;
  useEffect(() => {
    if (!justMade) return;
    haptic("success");
    valueMoment("playlist"); // D-090: may offer "Email me too? ✉️"
  }, [justMade]);

  // Lineup changed since the last build: refresh into the same playlist, once.
  const refreshPending = view.kind === "ready" && view.refresh === "pending";
  useEffect(() => {
    if (refreshPending) void start();
  }, [refreshPending, start]);

  // Step the active job until it finishes.
  const job = activeJob(view);
  useEffect(() => {
    if (!job) return;
    const timer = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/playlist-jobs/${job.jobId}/step`, { method: "POST" });
          apply(viewFromStep(await res.json().catch(() => null), viewRef.current, res.status));
        } catch {
          // Transient: try again on the normal cadence (never a tight loop).
          apply(afterFailedStep(viewRef.current));
        }
      },
      nextStepDelay(job, new Date()),
    );
    return () => clearTimeout(timer);
  }, [job, apply]);

  return (
    <section
      id="playlist"
      aria-labelledby="playlist-title"
      className="relative scroll-mt-24 rounded-tile border-2 border-night bg-surface p-5 shadow-[5px_6px_0_0_var(--color-night)] sm:p-7 dark:border-line dark:shadow-[5px_6px_0_0_var(--color-violet)]"
    >
      <h2 id="playlist-title" className="font-display text-big font-extrabold">
        The playlist <span aria-hidden>🎧</span>
      </h2>
      {pending && <p className="mt-2 text-lg font-semibold">{PLAYLIST_SOON}</p>}

      <div className="relative mt-6">
        <Actions view={view} onStart={start} pending={pending} />
        {view.kind === "ready" && view.justMade && <Confetti key={view.url} />}
      </div>

      <div role="status" aria-live="polite">
        <Note view={view} />
      </div>

      {/* UX #5: the secondary row (Share · Remind me · Tickets/Info), passed in by the page. */}
      {actions && <div className="mt-5 flex flex-wrap items-center gap-3">{actions}</div>}
    </section>
  );
}

function Actions({
  view,
  onStart,
  pending,
}: {
  view: PlaylistView;
  onStart: () => void;
  /** Nothing to make yet: no "Make playlist" or "Try again". */
  pending: boolean;
}) {
  switch (view.kind) {
    case "ready":
      return (
        <SpotifyOpenLink href={view.url}>
          <span aria-hidden>▶</span> Open in Spotify
        </SpotifyOpenLink>
      );
    case "unavailable":
      return null;
    case "building":
    case "starting":
      return view.kind === "building" && isVisiblePause(view.waitUntil) ? null : (
        <Button size="lg" className="w-full" disabled aria-disabled>
          Making playlist…
        </Button>
      );
    case "problem":
      return pending ? null : (
        <Button size="lg" className="w-full" onClick={onStart}>
          Try again
        </Button>
      );
    case "checking":
      return (
        <div
          aria-busy="true"
          aria-label="Checking the playlist"
          className="skeleton h-14 w-full rounded-field"
        />
      );
    case "idle":
      return pending ? null : (
        <Button size="lg" className="w-full" onClick={onStart}>
          Make playlist <span aria-hidden>→</span>
        </Button>
      );
  }
}

function Note({ view }: { view: PlaylistView }) {
  const reduceMotion = useReducedMotion();
  const box = "mt-4 rounded-field border-2 border-night p-4 text-sm";
  let content: React.ReactNode = null;
  switch (view.kind) {
    case "starting":
      content = <p className={`${box} bg-surface-2`}>Starting…</p>;
      break;
    case "building":
      content = <Progress job={view} />;
      break;
    case "ready":
      content = (
        <div className={`${box} bg-lime text-on-block`}>
          <p className="font-semibold">
            Live on Spotify <span aria-hidden>🎉</span>
          </p>
          {view.refresh && (
            <div className="mt-3">
              <p className="font-semibold">Refreshing…</p>
              {view.refresh !== "pending" && (
                <Bar progress={view.refresh.progress} label={view.refresh.label} />
              )}
            </div>
          )}
        </div>
      );
      break;
    case "unavailable":
      content = (
        <p className={`${box} bg-orange text-on-block`}>
          Opening soon <span aria-hidden>😴</span>
        </p>
      );
      break;
    case "problem":
      content = <p className={`${box} bg-pink text-on-block`}>{view.message}</p>;
      break;
  }
  return (
    <AnimatePresence initial={false} mode="wait">
      {content && (
        <motion.div
          key={view.kind}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
          className="overflow-hidden"
        >
          {content}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Progress({ job }: { job: BuildProgress }) {
  return (
    <div className="mt-4 rounded-field border-2 border-night bg-surface-2 p-4 text-sm">
      {isVisiblePause(job.waitUntil) && job.waitUntil && (
        <p className="font-semibold">
          <span aria-hidden>🐢 </span>
          Paused · back at {formatClock(job.waitUntil)}
        </p>
      )}
      <Bar progress={job.progress} label={job.label} />
    </div>
  );
}

function Bar({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="mt-2">
      <p className="text-sm font-medium">{label}</p>
      <div
        role="progressbar"
        aria-label="Playlist progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={label}
        className="mt-2 h-2.5 overflow-hidden rounded-chip bg-surface"
      >
        <div
          className="h-full rounded-chip bg-violet transition-[width] duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
