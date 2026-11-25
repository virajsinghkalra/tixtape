import Link from "next/link";
import type { CSSProperties } from "react";
import type { EventSummary } from "@/application/ports/events";
import { eventTone } from "./event-color";
import { ticketLink } from "./links";
import { hasPhoto, type VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { HeartButton } from "./HeartButton";
import { toSavedShowInput } from "./saved/save-show";
import { lineupTeaser, playlistBadge } from "./lineup-copy";
import { formatStartTime, istParts, yearTag } from "./event-format";
import { ListenHere } from "./ListenHere";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { vibeEmoji, vibeOf } from "./vibe-copy";
import { VibeChip } from "./VibeChip";
import { ButtonLink } from "./ui/Button";
import { Countdown } from "./ui/Countdown";
import { cx } from "./ui/cx";
import { Sticker } from "./ui/Sticker";
import { TONE_CLASS } from "./ui/tone";
import { venueName } from "./venue";

type Props = {
  event: EventSummary;
  now: Date;
  /** Position in its list, for the staggered entrance. */
  index?: number;
  ticketUrl?: string | null;
  /** First few headliners, as a teaser. */
  headliners?: string[];
  variant?: "feed" | "compact";
  /** Why this card is here, e.g. "Olivia Dean plays here" on search results. */
  note?: string | null;
  /** D-082: the official poster; fills the colour block when there is one. */
  poster?: string | null;
  /** D-083: the top-billed artists; a collage (photos first) when there's no poster. */
  artists?: readonly VisualArtist[];
  /** UX #6: the shared playlist's state, shown as a "🎧 Live" / "⏳ Cooking" sticker. */
  playlistStatus?: "ready" | "building" | null;
  /** The playlist to play straight from the card (its own or its tour's). */
  playlistUrl?: string | null;
  /** A tour shown as one card (D-079): the featured date is `event`; the rest are listed. */
  tour?: TourInfo;
};

export type TourInfo = {
  /** "10 cities" or "3 dates". */
  count: string;
  /** "nearest: Mumbai · 21 Mar" or "next: Delhi NCR · 12 Mar". */
  featuredLine: string;
  stops: { id: string; label: string }[];
};

/** A feed card: a loud date block with stickers, then the facts. The whole card is one link. */
export function EventCard({
  event,
  now,
  index = 0,
  ticketUrl,
  headliners = [],
  variant = "feed",
  note,
  poster,
  artists = [],
  tour,
  playlistStatus = null,
  playlistUrl = null,
}: Props) {
  const badge = playlistBadge(playlistStatus);
  const photo = Boolean(poster ?? event.posterUrl) || artists.some(hasPhoto);
  const { day, month, weekday } = istParts(event.startsAt);
  // OD-5: a news page is "Info ↗", never "Buy tickets".
  const outbound = ticketLink([ticketUrl]);
  const compact = variant === "compact";
  const vibe = vibeOf(event.genre, event.type);
  const place = event.venue
    ? [event.venue.city, venueName(event.venue.name)].filter(Boolean).join(" · ")
    : "City TBA";

  return (
    <article
      data-testid="event-card"
      data-vibe={vibe}
      style={{ "--i": index } as CSSProperties}
      className={cx(
        "pop-in group relative flex h-full flex-col overflow-hidden rounded-card border-2 border-night bg-surface",
        "shadow-[4px_5px_0_0_var(--color-night)] transition-[translate,box-shadow] duration-(--duration-base) ease-spring",
        "hover:-translate-y-1 hover:shadow-[6px_8px_0_0_var(--color-night)] active:translate-y-0",
        "dark:border-line dark:shadow-[4px_5px_0_0_var(--color-violet)] dark:hover:shadow-[6px_8px_0_0_var(--color-violet)]",
        "has-[a:focus-visible]:outline-[3px] has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-focus",
      )}
    >
      {/* A sibling of the link, not inside it: no nested interactive elements. */}
      <HeartButton show={toSavedShowInput(event)} className="absolute top-2 right-2 z-10" />
      <Link
        href={`/events/${event.id}`}
        aria-label={badge === "🎧 Live" ? `${event.title}, playlist live` : undefined}
        className="flex flex-1 flex-col outline-none"
      >
        <div
          className={cx(
            "relative isolate flex flex-col justify-between gap-6 p-4",
            compact ? "min-h-36" : "min-h-48",
            photo ? "bg-night text-white" : TONE_CLASS[eventTone(event.id)],
          )}
        >
          {photo && (
            <div aria-hidden className="absolute inset-0 -z-10">
              <EventVisual
                poster={poster ?? event.posterUrl}
                artists={artists}
                label={event.title}
                className="transition-transform duration-(--duration-slow) group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.9),rgb(11_11_15/0.25)_65%,rgb(11_11_15/0.1))]" />
            </div>
          )}
          {/* pr-9: keeps the stickers clear of the heart (top-right). */}
          <div className="flex flex-wrap items-start justify-between gap-2 pr-9">
            <Countdown
              startsAt={event.startsAt.toISOString()}
              endsAt={event.endsAt?.toISOString() ?? null}
              now={now.toISOString()}
            />
            {badge && (
              <Sticker
                tone={playlistStatus === "ready" ? "lime" : "surface"}
                tilt={4}
                className="pop-in ml-auto"
              >
                {badge}
              </Sticker>
            )}
            {tour ? (
              <Sticker tone="night" tilt={3} emoji="🗺️">
                Tour · {tour.count}
              </Sticker>
            ) : (
              <Sticker tone="night" tilt={3} emoji={event.type === "festival" ? "🎪" : "🎤"}>
                {event.type === "festival" ? "Festival" : "Concert"}
              </Sticker>
            )}
          </div>
          <p className="font-display leading-none font-extrabold uppercase">
            <span className={compact ? "text-5xl" : "text-6xl"}>{day}</span>{" "}
            <span className="text-2xl">
              {month}
              {yearTag(event.startsAt) && ` ${yearTag(event.startsAt)}`}
            </span>
            <span className="mt-1 block text-sm font-bold tracking-wide normal-case">
              {weekday} · {formatStartTime(event.startsAt)}
            </span>
          </p>
        </div>
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <h3
            className={cx(
              "font-display leading-tight font-bold text-balance",
              compact ? "text-lg" : "text-xl",
            )}
          >
            {event.title}
          </h3>
          <p className="text-sm text-muted">
            <span aria-hidden>📍 </span>
            {place}
          </p>
          {note && (
            <p className="text-sm font-semibold text-accent-text">
              <span aria-hidden>✨ </span>
              {note}
            </p>
          )}
          <p className="mt-auto pt-2 text-sm font-semibold">
            <span aria-hidden>🎶 </span>
            {lineupTeaser(headliners, event.artistCount)}
          </p>
          <VibeChip vibe={vibe} seed={event.id} solo={event.artistCount === 1} />
        </div>
      </Link>
      {/* In a side-scrolling row an expanding list would stretch every card in the row (big
          empty gaps next to it): link to all the artist's dates instead. */}
      {tour && compact && (
        <Link
          href={`/search?artist=${encodeURIComponent(headliners[0] ?? event.title)}`}
          className="flex min-h-11 items-center justify-between gap-2 border-t border-dashed border-line px-4 py-2 text-sm font-semibold"
        >
          <span className="min-w-0 truncate">{tour.featuredLine}</span>
          <span className="shrink-0 text-accent-text">
            All {tour.count} <span aria-hidden>→</span>
          </span>
        </Link>
      )}
      {tour && !compact && (
        <details className="group/tour border-t border-dashed border-line px-4 py-2 text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-semibold">
            <span>{tour.featuredLine}</span>
            <span className="text-accent-text">
              All {tour.count}{" "}
              <span
                aria-hidden
                className="inline-block transition-transform group-open/tour:rotate-180"
              >
                ▾
              </span>
            </span>
          </summary>
          <ul className="pb-2">
            {tour.stops.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/events/${s.id}`}
                  className="flex min-h-11 items-center justify-between rounded-field px-2 hover:bg-surface-2"
                >
                  {s.label} <span aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      {/* Sell the playlist: one tap to Spotify, tickets a quiet link beside it. */}
      <div className="flex items-center gap-2 px-4 pb-4">
        {playlistUrl ? (
          <SpotifyOpenLink
            href={playlistUrl}
            size="md"
            className="min-w-0 flex-1 whitespace-nowrap"
            eventId={event.id}
          >
            {/* "Play the playlist" overflows the button at 360px next to Tickets. */}
            <span aria-hidden>{vibeEmoji(vibe)}</span> Play playlist
          </SpotifyOpenLink>
        ) : null}
        {playlistUrl && (
          <ListenHere url={playlistUrl} eventId={event.id} title={event.title} variant="icon" />
        )}
        {playlistUrl ? null : (
          <ButtonLink href={`/events/${event.id}#playlist`} variant="secondary" className="flex-1">
            <span aria-hidden>{vibeEmoji(vibe)}</span> Playlist <span aria-hidden>→</span>
          </ButtonLink>
        )}
        {outbound && !tour && (
          <a
            href={outbound.url}
            target="_blank"
            rel="noopener noreferrer"
            data-track={outbound.kind === "tickets" ? "ticket_click" : undefined}
            data-track-event={outbound.kind === "tickets" ? event.id : undefined}
            className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-muted underline-offset-4 hover:underline"
          >
            {outbound.kind === "tickets" ? "Tickets" : "Info"}
          </a>
        )}
      </div>
    </article>
  );
}
