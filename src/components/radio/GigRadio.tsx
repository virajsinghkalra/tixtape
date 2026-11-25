"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { track } from "../analytics/track";
import { EventVisual } from "../EventVisual";
import { HeartButton } from "../HeartButton";
import { SILENCE, audio, songFor, stopClip } from "../ListenHere";
import { SpotifyOpenLink } from "../SpotifyOpenLink";
import { EqBars } from "../ui/EqBars";
import { cx } from "../ui/cx";

export type RadioCard = {
  id: string;
  title: string;
  artist: string;
  when: string;
  city: string | null;
  startsAt: string;
  poster: string | null;
  artists: VisualArtist[];
  playlistUrl: string;
  ticketUrl: string | null;
  tag: string;
  /** The radio station this card belongs to (vibe key: "edm", "punjabi"…). */
  vibe: string;
  /** The first song's clip when already known on the server (plays with no extra request). */
  song?: { name: string; artist: string; audio: string } | null;
};

const SEEN_KEY = "tt.radio.seen";

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function markSeen(id: string) {
  try {
    const seen = readSeen();
    if (seen.has(id)) return;
    seen.add(id);
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300)));
  } catch {
    // Best effort.
  }
}

/** A clip heard this long counts as "vibed": it lands in the end-of-radio recap. */
const VIBED_SECS = 10;
type Song = NonNullable<RadioCard["song"]>;

/**
 * 📻 Gig Radio (analysis, 26 Nov: listeners hop across gigs, cities and genres like changing
 * stations; most decide within a minute). Every gig is a full-screen card that plays its first
 * song as you land on it, and a song that ends moves on by itself.
 * - Start: plays straight away when you arrive from a tap on the site (the tap unlocked sound);
 *   from a shared link, one tap starts it.
 * - Stations: genre chips tune the feed; returning visitors get unheard gigs first ("New").
 * - Lock screen: the phone's media controls show the gig and skip to the next one.
 * - The core line: every card's main button is the full playlist on Spotify, and the end
 *   recaps the gigs you vibed to, each with its Spotify button.
 */
export function GigRadio({ cards: initial }: { cards: RadioCard[] }) {
  const [order, setOrder] = useState(initial);
  const [station, setStation] = useState("all");
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [flash, setFlash] = useState<"play" | "pause" | null>(null);
  const [hint, setHint] = useState(false);
  const [vibed, setVibed] = useState<string[]>([]);
  const [songs, setSongs] = useState<Record<string, Song | null>>(() =>
    Object.fromEntries(initial.filter((c) => c.song).map((c) => [c.id, c.song!])),
  );
  const feed = useRef<HTMLDivElement>(null);
  const preload = useRef<HTMLAudioElement | null>(null);

  const cards = useMemo(
    () => (station === "all" ? order : order.filter((c) => c.vibe === station)),
    [order, station],
  );
  const stations = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of initial) if (!seen.has(c.vibe)) seen.set(c.vibe, c.tag);
    return [...seen];
  }, [initial]);

  // Returning visitor: unheard gigs first (a shared ?g= card stays on top).
  useEffect(() => {
    const seen = readSeen();
    if (seen.size === 0) return;
    const [lead, ...rest] = initial;
    if (!lead) return;
    const unseen = rest.filter((c) => !seen.has(c.id));
    setFresh(new Set(unseen.map((c) => c.id)));
    setOrder([lead, ...unseen, ...rest.filter((c) => seen.has(c.id))]);
  }, [initial]);

  // Arrived from a tap on the site: that tap unlocked sound, so the radio just starts.
  useEffect(() => {
    const a = audio();
    a.src = SILENCE;
    a.play().then(
      () => setStarted(true),
      () => {},
    );
  }, []);

  // The card in view is the one on air.
  useEffect(() => {
    const root = feed.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-index]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cards]);

  /** Moves to a card (also from the lock screen, where scrolling alone may not fire). */
  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(cards.length, i));
      setActive(target);
      feed.current
        ?.querySelector(`[data-index="${target}"]`)
        ?.scrollIntoView({ behavior: "smooth" });
    },
    [cards.length],
  );
  const step = useRef({ next: () => {}, prev: () => {} });
  step.current = { next: () => goTo(active + 1), prev: () => goTo(active - 1) };

  // On air: play this card's song (inline from the server, else fetched); warm up the next.
  useEffect(() => {
    const card = cards[active];
    setProgress(0);
    if (!started) return;
    if (!card) {
      stopClip(); // The end card.
      setPlaying(false);
      return;
    }
    let live = true;
    const a = audio();
    a.onended = () => {
      setPlaying(false);
      step.current.next();
    };
    a.ontimeupdate = () => {
      if (!live || !a.duration) return;
      setProgress(a.currentTime / a.duration);
      if (a.currentTime >= VIBED_SECS) setVibed((v) => (v.includes(card.id) ? v : [...v, card.id]));
    };
    stopClip();
    setPlaying(false);
    const known = songs[card.id];
    const load = known
      ? Promise.resolve(known)
      : songFor(card.playlistUrl).then(({ song }) => song);
    let skip: ReturnType<typeof setTimeout> | undefined;
    void load.then((song) => {
      if (!live) return;
      if (!known) setSongs((s) => ({ ...s, [card.id]: song }));
      // No clip: show the Spotify button for a moment, then keep the radio moving.
      if (!song) {
        skip = setTimeout(() => step.current.next(), 3_500);
        return;
      }
      a.src = song.audio;
      void a.play().then(
        () => {
          if (!live) return;
          setPlaying(true);
          markSeen(card.id);
          track("playlist_preview", { eventId: card.id });
          lockScreen(card, song, step.current);
        },
        () => live && setPlaying(false),
      );
    });
    const ahead = cards[active + 1];
    if (ahead) {
      const warm = (song: Song | null) => {
        if (!song || !live) return;
        preload.current ??= new Audio();
        preload.current.preload = "auto";
        preload.current.src = song.audio;
      };
      if (songs[ahead.id]) warm(songs[ahead.id]!);
      else void songFor(ahead.playlistUrl).then(({ song }) => warm(song));
    }
    return () => {
      live = false;
      clearTimeout(skip);
    };
    // `songs` is read, not watched: a fetched song must not restart the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, started, cards]);

  // "Swipe up" nudge if the first card plays for a while with no swipe.
  useEffect(() => {
    setHint(false);
    if (!started || active !== 0) return;
    const t = setTimeout(() => setHint(true), 5_000);
    return () => clearTimeout(t);
  }, [started, active]);

  // Desktop: arrows and space.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.("input, textarea")) return;
      const act =
        e.key === "ArrowDown" || e.key === "j"
          ? step.current.next
          : e.key === "ArrowUp" || e.key === "k"
            ? step.current.prev
            : e.key === " "
              ? toggleRef.current
              : null;
      if (!act) return;
      e.preventDefault();
      act();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Leaving the radio stops the music and clears the lock screen.
  useEffect(
    () => () => {
      stopClip();
      clearLockScreen();
    },
    [],
  );

  const start = () => {
    const a = audio();
    a.src = SILENCE;
    void a.play().catch(() => {});
    setStarted(true);
  };
  const toggle = () => {
    if (!started) return start();
    const a = audio();
    if (a.paused) {
      void a.play().then(
        () => setPlaying(true),
        () => {},
      );
      setFlash("play");
    } else {
      a.pause();
      setPlaying(false);
      setFlash("pause");
    }
    setTimeout(() => setFlash(null), 600);
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  const tune = (v: string) => {
    if (v === station) return;
    setStation(v);
    setActive(0);
    feed.current?.scrollTo({ top: 0 });
  };

  const recap = order.filter((c) => vibed.includes(c.id)).slice(0, 5);

  return (
    <div className="fixed inset-0 z-[55] bg-night text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-3 p-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="Close Gig Radio"
            className="pointer-events-auto grid size-10 place-items-center rounded-full bg-night/60 text-lg font-bold backdrop-blur"
          >
            ✕
          </Link>
          <span className="flex items-center gap-2 rounded-chip bg-lime px-3 py-1 font-display text-sm font-extrabold text-on-block">
            <span className={cx(!playing && "opacity-40")}>
              <EqBars />
            </span>
            Gig Radio
          </span>
          <span className="size-10" />
        </div>
        {stations.length > 1 && (
          <div
            role="tablist"
            aria-label="Stations"
            className="no-scrollbar pointer-events-auto -mx-4 flex gap-2 overflow-x-auto px-4"
          >
            {[["all", "📻 All"] as const, ...stations].map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={station === v}
                onClick={() => tune(v)}
                className={cx(
                  "shrink-0 rounded-chip px-3 py-1 text-xs font-bold backdrop-blur transition-colors",
                  station === v ? "bg-white text-night" : "bg-white/15 text-white",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={feed}
        onClickCapture={(e) => {
          if ((e.target as Element).closest("a[href*='open.spotify.com']")) {
            stopClip();
            setPlaying(false);
          }
        }}
        className="no-scrollbar h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain"
      >
        {cards.map((c, i) => {
          const song = songs[c.id];
          const onAir = started && i === active;
          return (
            <section
              key={`${station}-${c.id}`}
              data-index={i}
              aria-label={`${c.artist}, ${c.when}`}
              className="relative h-dvh snap-start snap-always overflow-hidden"
            >
              <EventVisual
                poster={c.poster}
                artists={c.artists}
                label={c.artist}
                priority={i < 2}
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.95),rgb(11_11_15/0.35)_55%,rgb(11_11_15/0.6))]"
              />
              {onAir && (
                <div aria-hidden className="absolute inset-x-0 bottom-0 z-10 h-1 bg-white/15">
                  <div
                    className="h-full bg-lime transition-[width] duration-300 ease-linear"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={toggle}
                aria-label={started ? (playing && onAir ? "Pause" : "Play") : "Start Gig Radio"}
                className="absolute inset-0 z-[1]"
              />
              {onAir && flash && (
                <span
                  aria-hidden
                  className="pop-in pointer-events-none absolute top-1/2 left-1/2 z-10 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-night/70 text-3xl"
                >
                  {flash === "play" ? "▶" : "❚❚"}
                </span>
              )}

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end gap-3 p-5 pb-[max(1.75rem,env(safe-area-inset-bottom))]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-chip bg-white/15 px-2.5 py-0.5 text-xs font-bold backdrop-blur">
                      {c.tag}
                    </span>
                    {fresh.has(c.id) && (
                      <span className="rounded-chip bg-lime px-2.5 py-0.5 text-xs font-extrabold text-on-block">
                        🆕 New
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-display text-[2.6rem] leading-[0.95] font-extrabold tracking-tight [overflow-wrap:anywhere]">
                    {c.artist}
                  </p>
                  <p className="mt-2 text-sm font-semibold text-white/80">
                    {c.when}
                    {c.city ? ` · ${c.city}` : ""}
                  </p>
                  <p className="mt-3 flex items-center gap-2 text-sm font-semibold">
                    <span className={cx("text-lime", !(onAir && playing) && "opacity-40")}>
                      <EqBars />
                    </span>
                    <span className="truncate">
                      {song
                        ? `♪ ${song.name} · ${song.artist}`
                        : onAir && song === null
                          ? "No preview here. The playlist's on Spotify 👇"
                          : onAir
                            ? "Tuning in…"
                            : "♪ Swipe to hear"}
                    </span>
                  </p>
                  {/* The core line: the clip is the taste, the Spotify playlist is the point. */}
                  <div className="pointer-events-auto mt-4">
                    <SpotifyOpenLink
                      href={c.playlistUrl}
                      eventId={c.id}
                      className={cx(onAir && playing && progress > 0.6 && "play-pulse")}
                    >
                      <span aria-hidden>▶</span> Full playlist on Spotify
                    </SpotifyOpenLink>
                  </div>
                </div>

                <div className="pointer-events-auto mb-1 flex shrink-0 flex-col items-center gap-3">
                  <HeartButton
                    show={{ id: c.id, title: c.title, startsAt: c.startsAt, city: c.city }}
                  />
                  <ShareButton card={c} />
                  <Link
                    href={`/events/${c.id}`}
                    className="grid size-12 place-items-center rounded-full bg-white/15 text-lg backdrop-blur"
                    aria-label={`${c.title}: gig details`}
                  >
                    🎟️
                  </Link>
                </div>
              </div>

              {onAir && i === 0 && hint && (
                <span
                  aria-hidden
                  className="rail-nudge pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 rounded-chip bg-white/90 px-3 py-1.5 text-sm font-bold text-night"
                >
                  ↑ Swipe for the next gig
                </span>
              )}

              {!started && i === 0 && (
                <button
                  type="button"
                  onClick={start}
                  className="absolute inset-x-6 top-1/3 z-20 flex flex-col items-center gap-3 rounded-card border-2 border-night bg-lime px-6 py-6 text-on-block shadow-[4px_6px_0_0_var(--color-violet)]"
                >
                  <span className="play-pulse grid size-16 place-items-center rounded-full bg-night text-2xl text-lime">
                    ▶
                  </span>
                  <span className="font-display text-2xl font-extrabold">
                    Tap to start the radio
                  </span>
                  <span className="text-sm font-semibold">
                    Every gig plays. Swipe up for the next.
                  </span>
                </button>
              )}
            </section>
          );
        })}

        <section
          data-index={cards.length}
          className="flex h-dvh snap-start flex-col justify-center gap-5 overflow-y-auto p-6 pt-28"
        >
          <p className="font-display text-big leading-tight font-extrabold">
            {recap.length > 0 ? "Your radio picks 🎧" : "That's every gig 🎉"}
          </p>
          {recap.length > 0 && (
            <ol className="flex flex-col gap-2.5">
              {recap.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-field bg-white/10 p-2 pl-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{c.artist}</span>
                    <span className="block truncate text-xs text-white/70">
                      {c.when}
                      {c.city ? ` · ${c.city}` : ""}
                    </span>
                  </span>
                  <SpotifyOpenLink
                    href={c.playlistUrl}
                    eventId={c.id}
                    size="md"
                    className="w-auto shrink-0"
                  >
                    <span aria-hidden>▶</span> Spotify
                  </SpotifyOpenLink>
                </li>
              ))}
            </ol>
          )}
          <button
            type="button"
            onClick={() => goTo(0)}
            className="self-start rounded-field border-2 border-white/30 px-5 py-3 font-bold"
          >
            ↺ Play it again
          </button>
        </section>
      </div>
    </div>
  );
}

/** The phone's lock screen / notification: the gig, its artwork, and skip buttons. */
function lockScreen(card: RadioCard, song: Song, step: { next: () => void; prev: () => void }) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    const art = card.poster ?? card.artists[0]?.imageUrl ?? null;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: `${song.artist} · ${card.artist}, ${card.when}`,
      album: "Tixtape Gig Radio",
      artwork: art ? [{ src: art, sizes: "512x512" }] : [],
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => step.next());
    navigator.mediaSession.setActionHandler("previoustrack", () => step.prev());
  } catch {
    // Not every browser supports every action.
  }
}

function clearLockScreen() {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.setActionHandler("nexttrack", null);
    navigator.mediaSession.setActionHandler("previoustrack", null);
  } catch {
    // Best effort.
  }
}

function ShareButton({ card }: { card: RadioCard }) {
  const share = async () => {
    const url = `${window.location.origin}/radio?g=${card.id}`;
    const text = `Heard this? ${card.artist}, ${card.when}${card.city ? ` in ${card.city}` : ""} 🎧`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Gig Radio", text, url });
        track("share", { channel: "native", eventId: card.id });
        return;
      }
    } catch {
      return; // Dismissed.
    }
    track("share", { channel: "whatsapp", eventId: card.id });
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank");
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      aria-label={`Share ${card.artist}`}
      className="grid size-12 place-items-center rounded-full bg-white/15 text-lg backdrop-blur"
    >
      ↗
    </button>
  );
}
