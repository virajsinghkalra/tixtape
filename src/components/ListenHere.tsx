"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { currentEventId, track } from "./analytics/track";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { cx } from "./ui/cx";

/** The playlist ID from an open.spotify.com playlist URL, or null. */
export function spotifyPlaylistId(url: string): string | null {
  return /open\.spotify\.com\/(?:[\w-]+\/)?playlist\/([A-Za-z0-9]+)/u.exec(url)?.[1] ?? null;
}

/**
 * "Listen here" (funnel, 25 Nov: shared-link visitors left home without leaving for Spotify):
 * Spotify's own embed player in a sheet, so a song plays without leaving Tixtape. The iframe
 * loads only on tap. "Open full playlist" still goes to the app.
 */
export function ListenHere({
  url,
  eventId,
  title,
  className,
  variant = "chip",
}: {
  url: string;
  eventId?: string;
  title: string;
  className?: string;
  variant?: "chip" | "wide";
}) {
  const [open, setOpen] = useState(false);
  const id = spotifyPlaylistId(url);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!id) return null;
  const show = () => {
    track("playlist_preview", { eventId: eventId ?? currentEventId() });
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={show}
        className={cx(
          variant === "chip"
            ? "inline-flex items-center gap-1.5 rounded-chip border-2 border-night bg-surface px-2.5 py-1 text-xs font-bold shadow-[2px_2px_0_0_var(--color-night)] active:translate-y-px dark:border-line"
            : "flex w-full items-center justify-center gap-2 rounded-field border-2 border-night bg-surface px-4 py-3 font-bold shadow-[3px_3px_0_0_var(--color-night)] active:translate-y-px dark:border-line",
          className,
        )}
      >
        <span aria-hidden>🎧</span> Listen here
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${title} playlist`}
            className="fixed inset-0 z-[90] flex items-end justify-center bg-night/70 backdrop-blur-sm sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              className="pop-in w-full max-w-md rounded-t-card border-2 border-night bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-6px_0_0_var(--color-lime)] sm:rounded-card dark:border-line"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate font-display text-lg font-extrabold">{title}</p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid size-9 shrink-0 place-items-center rounded-full border-2 border-night bg-lime font-bold text-on-block"
                >
                  ✕
                </button>
              </div>
              <iframe
                title={`${title} on Spotify`}
                src={`https://open.spotify.com/embed/playlist/${id}?utm_source=generator&theme=0`}
                width="100%"
                height="352"
                loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                className="block rounded-[12px] border-0 bg-night"
              />
              <SpotifyOpenLink href={url} eventId={eventId} className="mt-3">
                <span aria-hidden>▶</span> Open full playlist
              </SpotifyOpenLink>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
