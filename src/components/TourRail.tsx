import Link from "next/link";
import type { CSSProperties } from "react";
import type { FeedRow } from "@/application/ports/event-feed";
import type { Tour } from "@/domain/events/front-page";
import { EventVisual } from "./EventVisual";
import { ListenHere } from "./ListenHere";
import { cx } from "./ui/cx";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { vibeEmoji, vibeOf } from "./vibe-copy";

/**
 * Home "🗺️ On tour": a swipeable rail of tall tour cards (user feedback, 24 Nov: the tours list
 * was plain text). The artist big, the route as "Delhi → Kolkata → Pune +10", a round Play for
 * the tour playlist, and a tap opens the tour page.
 */
export function TourRail({ tours }: { tours: Tour<FeedRow>[] }) {
  if (tours.length === 0) return null;
  return (
    <section aria-labelledby="tours-title" className="reveal mx-auto mt-16 max-w-6xl px-4 sm:px-6">
      <h2 id="tours-title" className="font-display text-big font-extrabold tracking-tight">
        <span aria-hidden className="mr-2">
          🗺️
        </span>
        On tour
      </h2>
      <p className="mt-1 text-muted">One playlist, every city.</p>
      <ul className="no-scrollbar -mx-4 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-1 pb-4 sm:-mx-6 sm:px-6">
        {tours.map((t, i) => (
          <li
            key={t.key}
            className="pop-in relative w-[72%] max-w-xs shrink-0 snap-start"
            style={{ "--i": i } as CSSProperties}
          >
            <TourCard tour={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TourCard({ tour }: { tour: Tour<FeedRow> }) {
  const lead = tour.events.find((e) => e.playlistUrl) ?? tour.featured;
  const artist = lead.headliners[0] ?? tour.title;
  const vibe = vibeOf(lead.genre, lead.type);
  const cities = [...new Set(tour.events.map((e) => e.city).filter(Boolean))] as string[];
  const route = cities.slice(0, 3).join(" → ");
  const more = cities.length - 3;
  return (
    <div
      data-vibe={vibe}
      className="group relative h-80 overflow-hidden rounded-card border-2 border-night bg-night text-white shadow-[4px_5px_0_0_var(--color-night)] transition-[translate,box-shadow] duration-(--duration-base) ease-spring hover:-translate-y-1 hover:shadow-[6px_8px_0_0_var(--color-night)] dark:border-line"
    >
      <Link
        href={`/search?artist=${encodeURIComponent(artist)}`}
        className="absolute inset-0"
        aria-label={`${artist} tour, ${cities.length} cities`}
      >
        <span className="absolute inset-0 transition-transform duration-700 ease-out group-hover:scale-105">
          <EventVisual artists={lead.headlinerArtists} label={artist} />
        </span>
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.95),rgb(11_11_15/0.35)_55%,rgb(11_11_15/0.05))]"
        />
        <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-chip border-2 border-night bg-lime px-2.5 py-0.5 text-xs font-bold text-on-block shadow-[2px_3px_0_0_var(--color-night)]">
          <span aria-hidden>🗺️</span>
          {cities.length > 1 ? `${cities.length} cities` : `${tour.events.length} dates`}
        </span>
        <span className={cx("absolute inset-x-4 bottom-4", lead.playlistUrl ? "pr-28" : "pr-14")}>
          <span className="block font-display text-2xl leading-tight font-extrabold [overflow-wrap:anywhere]">
            <span aria-hidden>{vibeEmoji(vibe)} </span>
            {artist}
          </span>
          <span className="mt-1 block text-sm font-semibold text-white/80">
            {route}
            {more > 0 && <span className="text-lime"> +{more}</span>}
          </span>
        </span>
      </Link>
      {lead.playlistUrl && (
        <ListenHere
          url={lead.playlistUrl}
          eventId={lead.id}
          title={`${artist} tour`}
          variant="icon"
          className="absolute right-[4.25rem] bottom-[1.1rem] z-10"
        />
      )}
      {lead.playlistUrl && (
        <SpotifyOpenLink
          href={lead.playlistUrl}
          eventId={lead.id}
          size="md"
          className="absolute right-3 bottom-4 z-10 w-auto [&>a]:size-12 [&>a]:rounded-full [&>a]:p-0"
        >
          <span aria-hidden className="translate-x-px text-lg leading-none">
            ▶
          </span>
          <span className="sr-only">Play the {artist} tour playlist</span>
        </SpotifyOpenLink>
      )}
    </div>
  );
}
