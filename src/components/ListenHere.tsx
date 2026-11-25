"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentEventId, track } from "./analytics/track";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { cx } from "./ui/cx";

/** Fired on `window` with `detail: boolean` when a Listen-here sheet opens or closes. */
export const LISTEN_EVENT = "tt:listen";

/** The playlist ID from an open.spotify.com playlist URL, or null. */
export function spotifyPlaylistId(url: string): string | null {
  return /open\.spotify\.com\/(?:[\w-]+\/)?playlist\/([A-Za-z0-9]+)/u.exec(url)?.[1] ?? null;
}

type Controller = {
  play: () => void;
  addListener: (e: string, cb: () => void) => void;
  destroy: () => void;
};
type IFrameApi = {
  createController: (
    el: HTMLElement,
    opts: { uri: string; width: string; height: number },
    cb: (c: Controller) => void,
  ) => void;
};

let apiPromise: Promise<IFrameApi> | null = null;

/** Spotify's iFrame API (loaded once, on the first tap): it lets us press play for the visitor. */
function loadSpotifyApi(): Promise<IFrameApi> {
  apiPromise ??= new Promise<IFrameApi>((resolve, reject) => {
    const w = window as Window & { onSpotifyIframeApiReady?: (api: IFrameApi) => void };
    w.onSpotifyIframeApiReady = resolve;
    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    script.onerror = () => {
      apiPromise = null;
      reject(new Error("Spotify iFrame API failed to load"));
    };
    document.body.appendChild(script);
  });
  return apiPromise;
}

/**
 * The embed, playing the first song as soon as it's ready (user, 25 Nov). Browsers that block
 * autoplay just show the player; a tap on its Play works. If the API can't load, a plain embed.
 */
function Player({ id, title }: { id: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [plain, setPlain] = useState(false);
  useEffect(() => {
    let ctrl: Controller | null = null;
    let gone = false;
    const fallback = setTimeout(() => !ctrl && setPlain(true), 6_000);
    loadSpotifyApi()
      .then((api) => {
        if (gone || !host.current) return;
        const el = document.createElement("div");
        host.current.appendChild(el);
        api.createController(
          el,
          { uri: `spotify:playlist:${id}`, width: "100%", height: 352 },
          (c) => {
            ctrl = c;
            clearTimeout(fallback);
            if (gone) return c.destroy();
            c.addListener("ready", () => c.play());
          },
        );
      })
      .catch(() => !gone && setPlain(true));
    return () => {
      gone = true;
      clearTimeout(fallback);
      ctrl?.destroy();
    };
  }, [id]);
  if (plain) {
    return (
      <iframe
        title={`${title} on Spotify`}
        src={`https://open.spotify.com/embed/playlist/${id}?utm_source=generator&theme=0`}
        width="100%"
        height="352"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        className="block rounded-[12px] border-0 bg-night"
      />
    );
  }
  return (
    <div
      ref={host}
      aria-label={`${title} on Spotify`}
      className="h-[352px] overflow-hidden rounded-[12px] bg-night [&_iframe]:block [&_iframe]:rounded-[12px] [&_iframe]:border-0"
    />
  );
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
  variant?: "chip" | "wide" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const id = spotifyPlaylistId(url);

  useEffect(() => {
    // A story behind the sheet holds its timer while the player is open.
    window.dispatchEvent(new CustomEvent(LISTEN_EVENT, { detail: open }));
    if (!open) return;
    // Capture phase: Escape closes only this sheet, not a story dialog behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey, true);
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
        aria-label={variant === "icon" ? `Listen to ${title} here` : undefined}
        className={cx(
          variant === "chip" &&
            "inline-flex items-center gap-1.5 rounded-chip border-2 border-night bg-surface px-2.5 py-1 text-xs font-bold shadow-[2px_2px_0_0_var(--color-night)] active:translate-y-px dark:border-line",
          variant === "wide" &&
            "flex w-full items-center justify-center gap-2 rounded-field border-2 border-night bg-surface px-4 py-3 font-bold shadow-[3px_3px_0_0_var(--color-night)] active:translate-y-px dark:border-line",
          variant === "icon" &&
            "grid size-11 shrink-0 place-items-center rounded-full border-2 border-night bg-surface text-lg shadow-[2px_3px_0_0_var(--color-night)] transition-transform duration-(--duration-base) ease-spring hover:-translate-y-0.5 active:translate-y-px dark:border-line",
          className,
        )}
      >
        {variant === "icon" ? (
          <span aria-hidden>🎧</span>
        ) : (
          <>
            <span aria-hidden>🎧</span> Listen here
          </>
        )}
      </button>
      {open &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${title} playlist`}
            className="fixed inset-0 z-[90] flex items-end justify-center bg-night/70 backdrop-blur-sm sm:items-center"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            // React bubbles portal events to the story behind: keep taps and keys here.
            onKeyDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
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
              <Player id={id} title={title} />
              {/* The embed's own "⊕ Save on Spotify" follows the playlist in the visitor's library. */}
              <p className="mt-3 flex items-center gap-2 rounded-field bg-lime/25 px-3 py-2 text-sm font-semibold">
                <span aria-hidden className="text-base">
                  ⊕
                </span>
                Vibing? Hit Save on Spotify. It&apos;s in your library before the gig.
              </p>
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
