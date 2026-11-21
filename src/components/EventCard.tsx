import Link from "next/link";
import type { CSSProperties } from "react";
import type { EventSummary } from "@/application/ports/events";
import { eventTone } from "./event-color";
import { lineupTeaser } from "./lineup-copy";
import { formatStartTime, istParts } from "./event-format";
import { ButtonLink } from "./ui/Button";
import { Countdown } from "./ui/Countdown";
import { cx } from "./ui/cx";
import { Sticker } from "./ui/Sticker";
import { TONE_CLASS } from "./ui/tone";

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
  /** A solo show's artist photo: fills the colour block so the card leads with a face. */
  image?: string | null;
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
  image,
  tour,
}: Props) {
  const photo = event.artistCount === 1 && image ? image : null;
  const { day, month, weekday } = istParts(event.startsAt);
  const compact = variant === "compact";
  const place = event.venue ? `${event.venue.city} · ${event.venue.name}` : "Venue TBA";

  return (
    <article
      data-testid="event-card"
      style={{ "--i": index } as CSSProperties}
      className={cx(
        "pop-in group flex h-full flex-col overflow-hidden rounded-card border-2 border-night bg-surface",
        "shadow-[4px_5px_0_0_var(--color-night)] transition-[translate,box-shadow] duration-(--duration-base) ease-spring",
        "hover:-translate-y-1 hover:shadow-[6px_8px_0_0_var(--color-night)] active:translate-y-0",
        "dark:border-line dark:shadow-[4px_5px_0_0_var(--color-violet)] dark:hover:shadow-[6px_8px_0_0_var(--color-violet)]",
        "has-[a:focus-visible]:outline-[3px] has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-focus",
      )}
    >
      <Link href={`/events/${event.id}`} className="flex flex-1 flex-col outline-none">
        <div
          className={cx(
            "relative isolate flex flex-col justify-between gap-6 p-4",
            compact ? "min-h-36" : "min-h-48",
            photo ? "bg-night text-white" : TONE_CLASS[eventTone(event.id)],
          )}
        >
          {photo && (
            <div aria-hidden className="absolute inset-0 -z-10">
              <div
                className="absolute inset-0 bg-cover bg-center transition-transform duration-(--duration-slow) group-hover:scale-105"
                style={{ backgroundImage: `url("${photo}")` }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.9),rgb(11_11_15/0.25)_65%,rgb(11_11_15/0.1))]" />
            </div>
          )}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Countdown
              startsAt={event.startsAt.toISOString()}
              endsAt={event.endsAt?.toISOString() ?? null}
              now={now.toISOString()}
            />
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
            <span className="text-2xl">{month}</span>
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
        </div>
      </Link>
      {tour && (
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
      {ticketUrl && !tour && (
        <div className="px-4 pb-4">
          <ButtonLink href={ticketUrl} external variant="secondary" className="w-full">
            <span aria-hidden>🎟️</span> Buy tickets
          </ButtonLink>
        </div>
      )}
    </article>
  );
}
