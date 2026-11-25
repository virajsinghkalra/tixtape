import Link from "next/link";
import type { CSSProperties } from "react";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { ListenHere } from "./ListenHere";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { EqBars } from "./ui/EqBars";
import { cx } from "./ui/cx";
import type { Vibe } from "./vibe-copy";

export type TrendingItem = {
  id: string;
  /** Short: "Diljit Dosanjh" or "Sunburn Festival 2026". */
  title: string;
  /** "29 Nov '26 · Bengaluru". */
  when: string;
  poster: string | null;
  artists: VisualArtist[];
  label: string;
  playlistUrl: string;
  vibe: Vibe;
  /** A couple of song names from the playlist, when known. */
  inside?: string[];
};

/**
 * "🔥 Hot in Bengaluru": a swipeable rail of mini players inside the hero (funnel, 24 Nov: most
 * visitors left without opening a show; user: "make it interactive, scroll, animations").
 * Each one is a spinning record, the show, and one round Play.
 */
export function HotRail({
  kicker,
  items,
  bleed = "tile",
}: {
  kicker: string;
  items: TrendingItem[];
  /** Inside the hero tile (its padding) or on the page (the page gutter). */
  bleed?: "tile" | "page";
}) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4" data-testid="hot-rail">
      <p
        className={cx(
          "flex items-center gap-2 font-extrabold",
          bleed === "page" ? "font-display text-big tracking-tight" : "text-sm",
        )}
      >
        <span aria-hidden className="hot-flame">
          🔥
        </span>
        {kicker}
        {items.length > 1 && (
          <span aria-hidden className="ml-auto text-xs font-bold opacity-70">
            swipe →
          </span>
        )}
      </p>
      <ul
        className={cx(
          "no-scrollbar mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2",
          bleed === "tile"
            ? "rail-nudge -mx-5 px-5 sm:-mx-7 sm:px-7"
            : "-mx-4 px-4 sm:-mx-6 sm:px-6",
        )}
      >
        {items.map((item, i) => (
          <li
            key={item.id}
            className="pop-in relative w-[86%] max-w-sm shrink-0 snap-start"
            style={{ "--i": i } as CSSProperties}
          >
            <MiniPlayer item={item} first={i === 0 && bleed === "tile"} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `first`: the hero's first player pulses its Play and the rail nudges once (funnel, 24 Nov: 19
 * of 32 visitors never opened a gig; the eye has to land on Play).
 */
function MiniPlayer({ item, first = false }: { item: TrendingItem; first?: boolean }) {
  return (
    <div
      data-vibe={item.vibe}
      data-testid="trending-card"
      className="group flex items-center gap-3 rounded-field border-2 border-night bg-night p-2 pr-2.5 text-white shadow-[3px_4px_0_0_var(--color-violet)] transition-transform duration-(--duration-base) ease-spring active:scale-[0.98]"
    >
      <Link
        href={`/events/${item.id}`}
        className="flex min-w-0 flex-1 items-center gap-3"
        aria-label={`${item.title}, ${item.when}`}
      >
        {/* A record that spins: the artwork in a disc with a hole in the middle. */}
        <span className="vinyl relative block size-14 shrink-0 overflow-hidden rounded-full border-2 border-white/15 bg-night">
          <EventVisual poster={item.poster} artists={item.artists} label={item.label} />
          <span
            aria-hidden
            className="absolute top-1/2 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-night bg-lime"
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-base leading-tight font-extrabold">
            {item.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-white/70">
            <span className="text-lime">
              <EqBars />
            </span>
            {item.when}
          </span>
        </span>
      </Link>
      <SpotifyOpenLink
        href={item.playlistUrl}
        eventId={item.id}
        size="md"
        className={cx(
          "w-auto shrink-0 [&>a]:size-12 [&>a]:rounded-full [&>a]:p-0",
          first && "play-pulse",
        )}
      >
        <span aria-hidden className="translate-x-px text-lg leading-none">
          ▶
        </span>
        <span className="sr-only">Play {item.title}</span>
      </SpotifyOpenLink>
    </div>
  );
}

/**
 * Home's "🔥 Hot in Bengaluru" shelf (user, 24 Nov: the rail inside the hero looked clumsy).
 * Album-style cards under the hero: square cover art with its record peeking out and spinning,
 * the full title on two lines, the date, and a round Play on the cover. The first Play pulses
 * and the shelf nudges once so the eye lands on it.
 */
export function HotShelf({
  kicker,
  items,
  className = "mt-8",
}: {
  kicker: string;
  items: TrendingItem[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={className} data-testid="hot-shelf">
      <div className="flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-big font-extrabold tracking-tight">
          <span aria-hidden className="hot-flame">
            🔥
          </span>
          {kicker}
        </h2>
        {items.length > 2 && (
          <span aria-hidden className="pb-1 text-sm font-bold text-muted">
            swipe →
          </span>
        )}
      </div>
      <ul className="rail-nudge no-scrollbar -mx-4 mt-4 flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto px-4 pt-1 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6">
        {items.map((item, i) => (
          <li
            key={item.id}
            className="pop-in relative w-[44%] max-w-[12rem] shrink-0 snap-start"
            style={{ "--i": i } as CSSProperties}
          >
            <AlbumCard item={item} first={i === 0} tilt={i % 2 === 0 ? -2 : 2} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AlbumCard({ item, first, tilt }: { item: TrendingItem; first: boolean; tilt: number }) {
  const href = `/events/${item.id}`;
  return (
    <div data-vibe={item.vibe} data-testid="trending-card" className="group">
      <div className="relative aspect-square">
        <Link href={href} className="absolute inset-0" aria-label={`${item.title}, ${item.when}`}>
          {/* The record, peeking out of the sleeve and spinning. */}
          <span
            aria-hidden
            className="absolute top-[7%] right-0 bottom-[7%] aspect-square rounded-full border-2 border-night bg-[repeating-radial-gradient(circle,#1b1b22_0_2px,#0b0b0f_2px_5px)] transition-transform duration-500 ease-out group-hover:translate-x-2"
          >
            <span className="vinyl absolute inset-0 rounded-full" />
            <span className="absolute top-1/2 left-1/2 size-[30%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-night bg-lime" />
          </span>
          <span
            style={{ rotate: `${tilt}deg` }}
            className="absolute inset-y-0 left-0 z-10 block w-[84%] overflow-hidden rounded-tile border-2 border-night bg-night shadow-[4px_5px_0_0_var(--color-night)] transition-transform duration-(--duration-base) ease-spring group-hover:-translate-y-1 dark:border-line"
          >
            <span className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-105">
              <EventVisual poster={item.poster} artists={item.artists} label={item.label} />
            </span>
          </span>
        </Link>
        <SpotifyOpenLink
          href={item.playlistUrl}
          eventId={item.id}
          size="md"
          className={cx(
            "absolute bottom-2 left-2 z-20 w-auto [&>a]:size-12 [&>a]:rounded-full [&>a]:p-0 [&>a]:shadow-[3px_3px_0_0_var(--color-night)]",
            first && "play-pulse",
          )}
        >
          <span aria-hidden className="translate-x-px text-lg leading-none">
            ▶
          </span>
          <span className="sr-only">Play {item.title}</span>
        </SpotifyOpenLink>
      </div>
      <Link href={href} className="mt-3 block" tabIndex={-1}>
        <span className="line-clamp-2 font-display text-base leading-tight font-extrabold [overflow-wrap:anywhere]">
          {item.title}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
          <span className="text-accent-text">
            <EqBars />
          </span>
          {item.when}
        </span>
        {item.inside && item.inside.length > 0 && (
          <span className="mt-1 line-clamp-2 text-xs leading-snug">
            <span aria-hidden className="text-accent-text">
              ♪{" "}
            </span>
            {item.inside.join(" · ")}
          </span>
        )}
      </Link>
      <ListenHere url={item.playlistUrl} eventId={item.id} title={item.title} className="mt-2" />
    </div>
  );
}
