"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { currentEventId, track } from "./analytics/track";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { EqBars } from "./ui/EqBars";
import { cx } from "./ui/cx";

/** Fired on `window` with `detail: boolean` when a Listen-here sheet opens or closes. */
export const LISTEN_EVENT = "tt:listen";

/** The playlist ID from an open.spotify.com playlist URL, or null. */
export function spotifyPlaylistId(url: string): string | null {
  return /open\.spotify\.com\/(?:[\w-]+\/)?playlist\/([A-Za-z0-9]+)/u.exec(url)?.[1] ?? null;
}

type Controller = {
  play: () => void;
  pause: () => void;
  addListener: (e: string, cb: (ev: { data?: { isPaused?: boolean } }) => void) => void;
  destroy: () => void;
};

/** 0.1 s of silence: played inside the tap so the phone lets this page start sound later. */
export const SILENCE =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

/** One preview player for the whole page (a new tap takes it over). */
let shared: HTMLAudioElement | null = null;
export const audio = () => (shared ??= new Audio());
export const stopClip = () => {
  if (shared && !shared.paused) shared.pause();
};
/** The open sheet's Spotify player, so starting our clip can pause it. */
let embed: Controller | null = null;

/**
 * Spotify's player tells the page when it starts playing (postMessage). The iFrame API's own
 * listener didn't pass it on (bug, 25 Nov: two songs at once), so read the messages directly.
 */
export function embedStartedPlaying(origin: string, data: unknown): boolean {
  if (origin !== "https://open.spotify.com" || !data || typeof data !== "object") return false;
  const m = data as { type?: string; payload?: { isPaused?: boolean } };
  return (
    m.type === "playback_started" || (m.type === "playback_update" && m.payload?.isPaused === false)
  );
}

type Song = { name: string; artist: string; audio: string };
export type Listen = { song: Song | null; tracks: { name: string; artist: string }[] };
const NOTHING: Listen = { song: null, tracks: [] };

/** One request per playlist per visit, started on touch-down (before the tap lands). */
const songs = new Map<string, Promise<Listen>>();
export function songFor(url: string): Promise<Listen> {
  let p = songs.get(url);
  if (!p) {
    p = fetch(`/api/listen?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Listen>) : NOTHING))
      .then((r) => ({ song: r.song ?? null, tracks: r.tracks ?? [] }))
      .catch(() => {
        songs.delete(url);
        return NOTHING;
      });
    songs.set(url, p);
  }
  return p;
}

/** Touch-down: fetch the song while the finger lifts. */
function warm(url: string) {
  void songFor(url);
}
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
 * Spotify's embed, for the whole playlist and "Save on Spotify". It presses play itself only
 * when we have no preview clip (`autoplay`); when the visitor plays it, our clip stops.
 */
function Player({
  id,
  title,
  autoplay,
  onEmbedPlay,
}: {
  id: string;
  title: string;
  autoplay: boolean;
  onEmbedPlay: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [plain, setPlain] = useState(false);
  const ready = useRef<Controller | null>(null);
  const auto = useRef(autoplay);
  const onPlay = useRef(onEmbedPlay);
  useEffect(() => {
    auto.current = autoplay;
    onPlay.current = onEmbedPlay;
    if (autoplay) ready.current?.play();
  }, [autoplay, onEmbedPlay]);
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
            c.addListener("ready", () => {
              ready.current = c;
              embed = c;
              if (auto.current) c.play();
            });
            c.addListener("playback_update", (ev) => {
              if (ev.data && ev.data.isPaused === false) onPlay.current();
            });
          },
        );
      })
      .catch(() => !gone && setPlain(true));
    return () => {
      gone = true;
      clearTimeout(fallback);
      if (embed === ctrl) embed = null;
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
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(false);
  const [tracks, setTracks] = useState<Listen["tracks"]>([]);
  /** Spotify's player (3 MB, ~6 s on a phone) loads only on "Save on Spotify" (user, 25 Nov). */
  const [full, setFull] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** The 30 s clip ran out: nudge toward the full playlist on Spotify. */
  const [clipDone, setClipDone] = useState(false);
  /** No clip found: let the embed try to play by itself. */
  const [embedAuto, setEmbedAuto] = useState(false);
  const id = spotifyPlaylistId(url);
  const button = useRef<HTMLButtonElement>(null);

  // On screen: fetch the song's details while idle (a tiny, edge-cached JSON), so the first tap
  // isn't waiting on a cold server. The clip itself still loads only on the tap.
  useEffect(() => {
    const el = button.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      const go = () => void songFor(url);
      if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 2_000 });
      else setTimeout(go, 300);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [url]);

  // Our clip stops when the sheet closes.
  useEffect(() => {
    if (open) return;
    if (shared && !shared.paused) shared.pause();
    setPlaying(false);
  }, [open]);

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
    // Spotify's player started: our clip stops, so two songs never play at once.
    const onMessage = (e: MessageEvent) => {
      if (!embedStartedPlaying(e.origin, e.data)) return;
      stopClip();
      setPlaying(false);
    };
    window.addEventListener("message", onMessage);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("message", onMessage);
    };
  }, [open]);

  if (!id) return null;
  const show = () => {
    track("playlist_preview", { eventId: eventId ?? currentEventId() });
    // Inside the tap: unlock sound for this page, then play the first song's clip when it lands
    // (user, 25 Nov: "first song should play automatically"; phones block the embed doing it).
    const a = audio();
    a.src = SILENCE;
    void a.play().catch(() => {});
    a.preload = "auto";
    setSong(null);
    setTracks([]);
    setFull(false);
    setLoading(true);
    setEmbedAuto(false);
    setClipDone(false);
    setOpen(true);
    songFor(url)
      .then(({ song: s, tracks: list }) => {
        setLoading(false);
        setTracks(list);
        if (!s) return setEmbedAuto(true);
        setSong(s);
        a.src = s.audio;
        a.onended = () => {
          setPlaying(false);
          setClipDone(true);
        };
        a.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        );
      })
      .catch(() => {
        setLoading(false);
        setEmbedAuto(true);
      });
  };
  const toggle = () => {
    const a = audio();
    if (a.paused) {
      embed?.pause();
      setClipDone(false);
      void a.play().then(
        () => setPlaying(true),
        () => {},
      );
    } else {
      a.pause();
      setPlaying(false);
    }
  };
  const embedPlayed = () => {
    stopClip();
    setPlaying(false);
    setClipDone(false);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={show}
        onPointerDown={() => warm(url)}
        onMouseEnter={() => warm(url)}
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
              {loading && (
                <div className="mb-3 flex items-center gap-3 rounded-field border-2 border-night bg-night p-2 text-white dark:border-line">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-lime text-on-block">
                    <EqBars />
                  </span>
                  <span className="text-sm font-semibold text-white/80">
                    Cueing up the first song…
                  </span>
                </div>
              )}
              {song && (
                <button
                  type="button"
                  onClick={toggle}
                  className="mb-3 flex w-full items-center gap-3 rounded-field border-2 border-night bg-night p-2 pr-3 text-left text-white dark:border-line"
                >
                  <span
                    aria-hidden
                    className={cx(
                      "grid size-10 shrink-0 place-items-center rounded-full bg-lime text-on-block",
                      playing && "play-pulse",
                    )}
                  >
                    {playing ? "❚❚" : "▶"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{song.name}</span>
                    <span className="block truncate text-xs text-white/70">
                      {song.artist} · {playing ? "Now playing" : "Tap to play"} · preview
                    </span>
                  </span>
                  {playing && (
                    <span className="text-lime">
                      <EqBars />
                    </span>
                  )}
                </button>
              )}
              {/* The main action: the full playlist on Spotify. Our clip is only a teaser. */}
              {/* Off to Spotify: our clip stops (it would keep playing behind the app). */}
              <div onClickCapture={embedPlayed} className="mb-3">
                {clipDone && (
                  <p className="mb-2 text-center text-sm font-bold">
                    That was 30s. The full set&apos;s on Spotify 👇
                  </p>
                )}
                <SpotifyOpenLink
                  href={url}
                  eventId={eventId}
                  className={cx("w-full", clipDone && "play-pulse")}
                >
                  <span aria-hidden>▶</span> Open full playlist on Spotify
                </SpotifyOpenLink>
              </div>
              {tracks.length > 1 && !full && (
                <ol className="mb-3 flex flex-col gap-1 rounded-field bg-bg p-2">
                  {tracks.slice(0, 4).map((t, n) => (
                    <li
                      key={`${t.name}-${n}`}
                      className={cx(
                        "flex items-center gap-3 rounded-[10px] px-2 py-1.5 text-sm",
                        song?.name === t.name && "bg-lime/30 font-bold",
                      )}
                    >
                      <span className="w-4 text-center text-xs font-bold text-muted">{n + 1}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {t.name} <span className="font-normal text-muted">· {t.artist}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {full || embedAuto ? (
                <>
                  <Player id={id} title={title} autoplay={embedAuto} onEmbedPlay={embedPlayed} />
                  {/* The embed's own "⊕ Save on Spotify" follows the playlist in the visitor's library. */}
                  <p className="mt-3 flex items-center gap-2 rounded-field bg-lime/25 px-3 py-2 text-sm font-semibold">
                    <span aria-hidden className="text-base">
                      ⊕
                    </span>
                    Hit Save on Spotify above. It&apos;s in your library before the gig.
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setFull(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-field border-2 border-night bg-surface px-4 py-3 font-bold shadow-[3px_3px_0_0_var(--color-night)] active:translate-y-px dark:border-line"
                >
                  <span aria-hidden>⊕</span> Save on Spotify · full player
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
