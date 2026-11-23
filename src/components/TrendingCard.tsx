import Link from "next/link";
import type { CSSProperties } from "react";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { EqBars } from "./ui/EqBars";
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
};

/**
 * "🔥 Hot in Bengaluru": a swipeable rail of mini players inside the hero (funnel, 24 Nov: most
 * visitors left without opening a show; user: "make it interactive, scroll, animations").
 * Each one is a spinning record, the show, and one round Play.
 */
export function HotRail({ kicker, items }: { kicker: string; items: TrendingItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4" data-testid="hot-rail">
      <p className="flex items-center gap-2 text-sm font-extrabold">
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
      <ul className="no-scrollbar -mx-5 mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2 sm:-mx-7 sm:px-7">
        {items.map((item, i) => (
          <li
            key={item.id}
            className="pop-in relative w-[86%] max-w-sm shrink-0 snap-start"
            style={{ "--i": i } as CSSProperties}
          >
            <MiniPlayer item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiniPlayer({ item }: { item: TrendingItem }) {
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
        className="w-auto shrink-0 [&>a]:size-12 [&>a]:rounded-full [&>a]:p-0"
      >
        <span aria-hidden className="translate-x-px text-lg leading-none">
          ▶
        </span>
        <span className="sr-only">Play {item.title}</span>
      </SpotifyOpenLink>
    </div>
  );
}
