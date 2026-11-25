"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { track } from "../analytics/track";
import { EventVisual } from "../EventVisual";
import { HeartButton } from "../HeartButton";
import { SILENCE, audio, songFor, stopClip, type Listen } from "../ListenHere";
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

/**
 * 📻 Gig Radio (analysis, 26 Nov): every gig as a full-screen card that plays its first song
 * as you land on it. One tap starts the radio (phones need it for sound); after that each swipe
 * plays the next gig, and a song that ends moves on by itself. Returning visitors get the gigs
 * they haven't heard yet first, marked "New".
 */
export function GigRadio({ cards: initial }: { cards: RadioCard[] }) {
  const [cards, setCards] = useState(initial);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  const [started, setStarted] = useState(false);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [songs, setSongs] = useState<Record<string, Listen["song"]>>({});
  const feed = useRef<HTMLDivElement>(null);
  const preload = useRef<HTMLAudioElement | null>(null);

  // Returning visitor: unheard gigs first (a shared ?g= card stays on top).
  useEffect(() => {
    const seen = readSeen();
    if (seen.size === 0) return;
    const [lead, ...rest] = initial;
    if (!lead) return;
    const unseen = rest.filter((c) => !seen.has(c.id));
    setFresh(new Set(unseen.map((c) => c.id)));
    setCards([lead, ...unseen, ...rest.filter((c) => seen.has(c.id))]);
  }, [initial]);

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

  const next = useCallback(() => {
    const root = feed.current;
    if (root) root.scrollBy({ top: root.clientHeight, behavior: "smooth" });
  }, []);

  // On air: play this card's song; warm up the next two.
  useEffect(() => {
    const card = cards[active];
    if (!started || !card) return;
    let live = true;
    const a = audio();
    a.onended = () => {
      setPlaying(false);
      next();
    };
    stopClip();
    setPlaying(false);
    void songFor(card.playlistUrl).then(({ song }) => {
      if (!live) return;
      setSongs((s) => ({ ...s, [card.id]: song }));
      if (!song) return;
      a.src = song.audio;
      void a.play().then(
        () => {
          if (!live) return;
          setPlaying(true);
          markSeen(card.id);
          track("playlist_preview", { eventId: card.id });
        },
        () => live && setPlaying(false),
      );
    });
    for (const ahead of cards.slice(active + 1, active + 3)) {
      void songFor(ahead.playlistUrl).then(({ song }) => {
        if (!song || ahead !== cards[active + 1]) return;
        preload.current ??= new Audio();
        preload.current.preload = "auto";
        preload.current.src = song.audio;
      });
    }
    return () => {
      live = false;
    };
  }, [active, started, cards, next]);

  // Leaving the radio stops the music.
  useEffect(() => () => stopClip(), []);

  const start = () => {
    const a = audio();
    a.src = SILENCE;
    void a.play().catch(() => {});
    setStarted(true);
  };
  const toggle = () => {
    const a = audio();
    if (a.paused)
      void a.play().then(
        () => setPlaying(true),
        () => {},
      );
    else {
      a.pause();
      setPlaying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] bg-night text-white">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
        <Link
          href="/"
          aria-label="Close Gig Radio"
          className="pointer-events-auto grid size-10 place-items-center rounded-full bg-night/60 text-lg font-bold backdrop-blur"
        >
          ✕
        </Link>
        <span className="rounded-chip bg-lime px-3 py-1 font-display text-sm font-extrabold text-on-block">
          📻 Gig Radio
        </span>
        <span className="size-10" />
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
              key={c.id}
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
                className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.95),rgb(11_11_15/0.35)_55%,rgb(11_11_15/0.55))]"
              />
              <button
                type="button"
                onClick={started ? toggle : start}
                aria-label={started ? (playing && onAir ? "Pause" : "Play") : "Start Gig Radio"}
                className="absolute inset-0 z-[1]"
              />

              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end gap-3 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
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
                        : onAir
                          ? "Tuning in…"
                          : "♪ Swipe to hear"}
                    </span>
                  </p>
                  {/* The core line (user, 26 Nov): the clip is the taste, the Spotify playlist is
                      where every card leads. */}
                  <div className="pointer-events-auto mt-4">
                    <SpotifyOpenLink
                      href={c.playlistUrl}
                      eventId={c.id}
                      className={cx(onAir && playing && "play-pulse")}
                    >
                      <span aria-hidden>▶</span> Full playlist on Spotify
                    </SpotifyOpenLink>
                  </div>
                </div>

                <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-3">
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

        <section className="grid h-dvh snap-start place-items-center p-8 text-center">
          <div className="flex flex-col items-center gap-4">
            <p className="font-display text-big font-extrabold">You heard every gig 🎉</p>
            <button
              type="button"
              onClick={() => feed.current?.scrollTo({ top: 0, behavior: "smooth" })}
              className="rounded-field border-2 border-night bg-lime px-5 py-3 font-bold text-on-block"
            >
              Play it again
            </button>
          </div>
        </section>
      </div>
    </div>
  );
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
