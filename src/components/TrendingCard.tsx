import Link from "next/link";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { EqBars } from "./ui/EqBars";

export type TrendingItem = {
  id: string;
  /** Already short: "Shreya Ghoshal · Bengaluru". */
  title: string;
  poster: string | null;
  artists: VisualArtist[];
  label: string;
  playlistUrl: string;
};

/** Home's one compact "Trending now" card: the show, one big Play, and a link to the show. */
export function TrendingCard({ item }: { item: TrendingItem }) {
  return (
    <div className="pop-in flex items-center gap-3 rounded-tile border-2 border-night bg-surface p-3 shadow-[4px_5px_0_0_var(--color-night)] dark:border-line">
      <Link
        href={`/events/${item.id}`}
        aria-label={item.title}
        className="relative block size-16 shrink-0 -rotate-2 overflow-hidden rounded-field border-2 border-night bg-night"
      >
        <EventVisual poster={item.poster} artists={item.artists} label={item.label} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold tracking-wide uppercase">
          <span aria-hidden>🔥</span> Trending now
        </p>
        <p className="line-clamp-2 font-display text-base leading-tight font-extrabold [overflow-wrap:anywhere]">
          {item.title.replace(" · ", " · ")}
        </p>
        <Link
          href={`/events/${item.id}`}
          className="inline-flex min-h-6 items-center text-sm font-semibold text-accent-text"
        >
          View show <span aria-hidden>&nbsp;→</span>
        </Link>
      </div>
      <SpotifyOpenLink
        href={item.playlistUrl}
        eventId={item.id}
        size="md"
        className="w-auto shrink-0"
      >
        <EqBars /> Play
      </SpotifyOpenLink>
    </div>
  );
}
