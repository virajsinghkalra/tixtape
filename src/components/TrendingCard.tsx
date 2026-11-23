import Link from "next/link";
import type { PreviewTrack } from "@/application/ports/spotify";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { EqBars } from "./ui/EqBars";
import { VibeChip } from "./VibeChip";
import type { Vibe } from "./vibe-copy";

export type TrendingItem = {
  id: string;
  /** Already short: "Shreya Ghoshal · Bengaluru". */
  title: string;
  /** "27 Nov '26 · Bengaluru". */
  when: string;
  poster: string | null;
  artists: VisualArtist[];
  label: string;
  playlistUrl: string;
  vibe: Vibe;
  /** A solo show (its vibe chip carries a tagline too). */
  solo: boolean;
  /** "Hot in Bengaluru" or "Trending now". */
  kicker: string;
  /** The playlist's first songs, when we have them. */
  inside: PreviewTrack[];
};

/**
 * Home's first screen (funnel, 24 Nov: 21 of 31 evening visitors left without opening a show).
 * One big card: the hottest playlist in the visitor's city, picture first, a couple of songs
 * they may know, and one full-width Play. Each piece is its own element.
 */
export function TrendingCard({ item }: { item: TrendingItem }) {
  const songs = item.inside.slice(0, 2).map((t) => t.name.replace(/\s*[([].*$/u, ""));
  return (
    <div
      data-vibe={item.vibe}
      data-testid="trending-card"
      className="pop-in overflow-hidden rounded-card border-2 border-night bg-surface shadow-[4px_5px_0_0_var(--color-night)] dark:border-line"
    >
      <Link href={`/events/${item.id}`} className="relative block h-44 bg-night sm:h-52">
        <EventVisual poster={item.poster} artists={item.artists} label={item.label} priority />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.92),rgb(11_11_15/0.2)_60%,rgb(11_11_15/0.05))]"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-chip border-2 border-night bg-lime px-2.5 py-0.5 text-xs font-bold text-on-block shadow-[2px_3px_0_0_var(--color-night)]">
          <span aria-hidden>🔥</span> {item.kicker}
        </span>
        <span className="absolute inset-x-3 bottom-3 text-white">
          <span className="line-clamp-2 font-display text-xl leading-tight font-extrabold [overflow-wrap:anywhere]">
            {item.title}
          </span>
          <span className="mt-0.5 block text-sm font-semibold opacity-85">
            {item.when} <span aria-hidden>→</span>
          </span>
        </span>
      </Link>
      <div className="flex flex-col gap-3 p-3">
        <VibeChip vibe={item.vibe} seed={item.id} solo={item.solo} />
        {songs.length > 0 && (
          <p className="text-sm">
            <span className="font-semibold text-muted">Inside </span>
            <span className="font-semibold">{songs.join(" · ")}</span>
            <span className="text-muted"> + more</span>
          </p>
        )}
        <SpotifyOpenLink href={item.playlistUrl} eventId={item.id} size="lg">
          <EqBars /> Play the playlist
        </SpotifyOpenLink>
      </div>
    </div>
  );
}
