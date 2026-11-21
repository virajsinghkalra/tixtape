"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  headline,
  previewPending,
  readyLine,
  showLine,
  tierLines,
  unmatchedLine,
  type PlaylistPreview,
} from "./playlist-preview";
import {
  activeJob,
  afterFailedStep,
  refreshView,
  formatClock,
  formatDay,
  nextStepDelay,
  viewFromStart,
  viewFromStatus,
  viewFromStep,
  type BuildProgress,
  type PlaylistView,
} from "./playlist-state";
import { orderLine, pendingLine, spotifyMatchLine } from "./lineup-copy";
import { ShareButton } from "./ShareButton";
import { Button, ButtonLink } from "./ui/Button";
import { Confetti } from "./ui/Confetti";
import { EASE_OUT_EXPO } from "./ui/motion";
import { Sticker } from "./ui/Sticker";
import { useToast } from "./ui/Toast";

type Props = {
  eventId: string;
  eventTitle: string;
  /** Status rendered on the server (GET /api/events/:id/playlist shape); null = unknown. */
  initialStatus?: unknown;
  /** The engine's plan for the show (D-065); null when it couldn't be loaded. */
  preview: PlaylistPreview | null;
  matched: number;
  total: number;
  /** The lineup in billing order, for "Playlist coming soon: we're matching …". */
  names: string[];
  /** For a solo show: "~32 songs · 2 h of Bhuwin" and "Bhuwin is on Spotify." */
  soloName?: string;
  /** Billing tiers with artists: one tier means "billing order", not "openers last". */
  tierCount: number;
};

/**
 * The event's one shared playlist (D-036, D-048 §D): made by the Tixtape account, public,
 * no login. States: ready, none → live staged progress → confetti, building (join), stale
 * (auto-refresh), partial, paused and unavailable. Steps the job about every 1.5s.
 */
export function PlaylistPanel({
  eventId,
  eventTitle,
  preview,
  matched,
  total,
  names,
  soloName,
  tierCount,
  initialStatus,
}: Props) {
  // Nothing matched yet (or a 0-song estimate): never "0 songs · 0 min", no "Make playlist".
  const pending = previewPending(preview, matched, total);
  const [view, setView] = useState<PlaylistView>(() =>
    initialStatus ? viewFromStatus(initialStatus) : { kind: "checking" },
  );
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
    if (!refreshing) setView({ kind: "starting" });
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
      <Sticker tone="lime" emoji="🎧">
        The playlist
      </Sticker>
      <h2 id="playlist-title" className="mt-3 font-display text-big font-extrabold">
        One playlist for everyone
      </h2>
      <p className="mt-2 text-sm text-muted">
        Made on Spotify by our Tixtape account. Public and free: no login, just open it and follow.
        It updates when the lineup changes.
      </p>

      {pending ? (
        <p className="mt-5 rounded-field border-2 border-night bg-surface-2 p-4 font-semibold">
          <span aria-hidden>⏳ </span>
          {pendingLine(names, total)}
        </p>
      ) : (
        <>
          {preview ? <PreviewBlock preview={preview} soloName={soloName} /> : null}
          <p className="mt-4 text-sm text-muted">
            {[orderLine(total, tierCount), spotifyMatchLine(matched, total, soloName)]
              .filter(Boolean)
              .join(" ")}
          </p>
        </>
      )}

      <div className="relative mt-6">
        <Actions view={view} eventTitle={eventTitle} onStart={start} pending={pending} />
        {view.kind === "ready" && view.justMade && <Confetti key={view.url} />}
      </div>

      <div role="status" aria-live="polite">
        <Note view={view} />
      </div>
    </section>
  );
}

/** "256 songs · about 16 h · matches the show (2 days × 8 h)", then songs per tier. */
function PreviewBlock({ preview, soloName }: { preview: PlaylistPreview; soloName?: string }) {
  const tiers = tierLines(preview);
  const widest = Math.max(...tiers.map((t) => t.songs), 1);
  const [count, ...rest] = headline(preview, soloName).split(" ");
  const missing = unmatchedLine(preview);
  return (
    <>
      <p className="mt-5">
        <span className="font-display text-huge font-extrabold tabular-nums">{count}</span>{" "}
        <span className="font-semibold">{rest.join(" ")}</span>
      </p>
      {showLine(preview) && <p className="text-sm text-muted">{showLine(preview)}</p>}
      <ul className="mt-4 space-y-3" aria-label="Songs per tier">
        {tiers.map((t) => (
          <li key={t.tier} className="text-sm">
            <p className="font-medium">{t.text}</p>
            <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-chip bg-surface-2">
              <div
                className="h-full origin-left rounded-chip bg-violet"
                style={{ transform: `scaleX(${t.songs / widest})` }}
              />
            </div>
          </li>
        ))}
      </ul>
      {missing && <p className="mt-3 text-sm font-semibold">{missing}</p>}
      {readyLine(preview) && <p className="mt-2 text-sm text-muted">{readyLine(preview)}</p>}
    </>
  );
}

function Actions({
  view,
  eventTitle,
  onStart,
  pending,
}: {
  view: PlaylistView;
  eventTitle: string;
  onStart: () => void;
  /** Nothing to make yet: no "Make playlist" or "Try again". */
  pending: boolean;
}) {
  const toast = useToast();
  switch (view.kind) {
    case "ready":
      return (
        <div className="flex flex-col gap-3">
          <ButtonLink href={view.url} external size="lg" className="w-full">
            <span aria-hidden>▶</span> Open in Spotify
          </ButtonLink>
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="secondary"
              onClick={() =>
                navigator.clipboard
                  .writeText(view.url)
                  .then(() => toast.show("Playlist link copied 🔗"))
                  .catch(() => toast.show("Couldn't copy the link.", "error"))
              }
            >
              Copy link
            </Button>
            <ShareButton
              title={`${eventTitle} playlist`}
              text={`The ${eventTitle} playlist on Spotify`}
              url={view.url}
            />
          </div>
        </div>
      );
    case "unavailable":
      return null;
    case "building":
    case "starting":
      return view.kind === "building" && view.waitUntil ? null : (
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
      content = <Progress job={view} joined={view.joined} />;
      break;
    case "ready":
      content = (
        <div className={`${box} bg-lime text-on-block`}>
          <p className="font-semibold">
            <span aria-hidden>🎉 </span>
            {view.justMade
              ? "It's live on Spotify. Follow it to keep it in your library."
              : "Live on Spotify"}
            {view.builtAt ? ` · updated ${formatDay(view.builtAt)}` : ""} · by Tixtape
          </p>
          {view.skipped.length > 0 && (
            <p className="mt-2">
              {view.skipped.length} {view.skipped.length === 1 ? "artist isn't" : "artists aren't"}{" "}
              on Spotify, so {view.skipped.length === 1 ? "it was" : "they were"} skipped:{" "}
              {view.skipped.join(", ")}.
            </p>
          )}
          {view.refresh && (
            <div className="mt-3">
              <p className="font-semibold">Lineup updated, refreshing playlist…</p>
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
          <span aria-hidden>😴 </span>
          Playlist making opens soon. We&apos;re connecting our Spotify account; check back in a
          little while.
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

function Progress({ job, joined }: { job: BuildProgress; joined: boolean }) {
  return (
    <div className="mt-4 rounded-field border-2 border-night bg-surface-2 p-4 text-sm">
      {job.waitUntil ? (
        <p className="font-semibold">
          <span aria-hidden>🐢 </span>
          Spotify asked us to slow down, continuing at {formatClock(job.waitUntil)}.
        </p>
      ) : (
        joined && <p className="font-semibold">Someone&apos;s already making it, joining in…</p>
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
