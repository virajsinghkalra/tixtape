import type { EventDetail } from "@/application/ports/events";
import { eventTone } from "./event-color";
import type { VisualArtist } from "@/domain/visuals/visuals";
import { EventVisual } from "./EventVisual";
import { formatDateRange, formatStartTime, hasEnded } from "./event-format";
import { titleSize, type TitleSize } from "./lineup-copy";
import { cx } from "./ui/cx";
import { ButtonLink } from "./ui/Button";
import { Countdown } from "./ui/Countdown";
import { Sticker } from "./ui/Sticker";
import { Tile } from "./ui/Tile";
import { PlayCta } from "./PlayCta";
import Link from "next/link";
import { vibeHref, vibeOf, vibeTag } from "./vibe-copy";
import { VENUE_SOON, venueName } from "./venue";

const STATUS: Record<EventDetail["status"], { emoji: string; label: string }> = {
  announced: { emoji: "📣", label: "Announced" },
  partial_lineup: { emoji: "🧩", label: "Lineup dropping" },
  full_lineup: { emoji: "✅", label: "Full lineup" },
  cancelled: { emoji: "🚫", label: "Cancelled" },
};

type Props = {
  event: EventDetail;
  now: Date;
  /** A ready playlist (own or tour's): the primary button plays it. */
  playUrl?: string | null;
  /** No playlist yet: play the top-billed artist instead. */
  fallbackPlay?: { name: string; url: string } | null;
};

/** Long titles step down a size so they never stack into four giant lines. */
const H1: Record<TitleSize, string> = { xl: "text-mega", lg: "text-huge", md: "text-big" };

/**
 * Event page header (UX #5): back link, the picture, stickers, the title and one facts row.
 * Desktop gets the one Play button here; phones get it in the sticky bottom bar.
 */
export function EventHeader({ event, now, playUrl = null, fallbackPlay = null }: Props) {
  const status = STATUS[event.status];
  const tag = vibeTag(vibeOf(event.genre, event.type)) ?? {
    emoji: event.type === "festival" ? "🎪" : "🎤",
    label: event.type === "festival" ? "Festival" : "Concert",
  };
  const ended = hasEnded(event.startsAt, event.endsAt, now);
  const vibeLink = vibeHref(vibeOf(event.genre, event.type));
  const venue = venueName(event.venue?.name);
  const where = event.venue
    ? venue
      ? `${venue}, ${event.venue.city}`
      : ended
        ? event.venue.city
        : `${event.venue.city} · ${VENUE_SOON}`
    : ended
      ? "India"
      : VENUE_SOON;
  // A real venue opens in Google Maps (people tap it to see where the gig is).
  const mapsUrl =
    venue && event.venue
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue}, ${event.venue.city}`)}`
      : null;
  const solo = event.lineup.length === 1 ? event.lineup[0]! : null;
  const ordered = [...event.lineup].sort((a, b) => a.billingRank - b.billingRank);
  const time = formatStartTime(event.startsAt);
  const when = [formatDateRange(event.startsAt, event.endsAt), time === "Time TBA" ? null : time]
    .filter(Boolean)
    .join(" · ");
  return (
    <header>
      <ButtonLink href="/" variant="ghost" className="-ml-3">
        <span aria-hidden>←</span> All events
      </ButtonLink>
      <Tile
        tone={eventTone(event.id)}
        className="pop-in mt-3 grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem] md:items-center"
      >
        <HeroPicture
          poster={event.posterUrl}
          artists={ordered}
          label={ordered[0]?.name ?? event.title}
          caption={solo?.name ?? null}
          credit={event.posterUrl ? (event.posterCredit ?? null) : null}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Countdown
              startsAt={event.startsAt.toISOString()}
              endsAt={event.endsAt?.toISOString() ?? null}
              now={now.toISOString()}
              size="md"
            />
            {/* The music's vibe ("⚡ EDM"), not a generic "Concert" (user feedback, 24 Nov). */}
            {vibeLink ? (
              <Link href={vibeLink} className="transition-transform active:scale-95">
                <Sticker tone="night" tilt={2} size="md" emoji={tag.emoji}>
                  {tag.label} <span aria-hidden>→</span>
                </Sticker>
              </Link>
            ) : (
              <Sticker tone="night" tilt={2} size="md" emoji={tag.emoji}>
                {tag.label}
              </Sticker>
            )}
            {/* Only news worth a sticker: "Cancelled", or a lineup still dropping (never for an
                ended show). "Announced" / "Full lineup" were noise. */}
            {(event.status === "cancelled" ||
              (event.status === "partial_lineup" &&
                !hasEnded(event.startsAt, event.endsAt, now))) && (
              <Sticker tone="surface" tilt={-2} size="md" emoji={status.emoji}>
                {status.label}
              </Sticker>
            )}
          </div>
          <h1
            className={cx(
              "mt-5 font-display font-extrabold tracking-tight text-balance [overflow-wrap:anywhere]",
              H1[titleSize(event.title)],
            )}
          >
            {event.title}
          </h1>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-lg font-semibold">
            <span className="flex items-baseline gap-2">
              <span aria-hidden>📅</span>
              <time dateTime={event.startsAt.toISOString()}>
                {when.replace(" · ", "\u00a0· ").replace(/(\d) (am|pm) IST/, "$1\u00a0$2\u00a0IST")}
              </time>
            </span>
            <span className="flex items-baseline gap-2">
              <span aria-hidden>📍</span>
              {mapsUrl ? (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-2 underline-offset-4 hover:decoration-4"
                >
                  {where}
                  <span className="sr-only"> (opens Google Maps)</span>
                </a>
              ) : (
                <span>{where}</span>
              )}
            </span>
          </p>
          <PlayCta
            eventId={event.id}
            playUrl={playUrl}
            fallback={fallbackPlay}
            className="mt-5 max-w-xs max-sm:hidden"
          />
        </div>
      </Tile>
    </header>
  );
}

/**
 * D-082: the hero picture for every event: the official poster, else a collage of the headliners'
 * Spotify photos, else a branded gradient with a sticker. Never an empty block.
 */
function HeroPicture({
  poster,
  artists,
  label,
  caption,
  credit,
}: {
  poster: string | null | undefined;
  artists: VisualArtist[];
  label: string;
  caption: string | null;
  /** D-083: shown tiny under the picture when the poster needs attribution. */
  credit: string | null;
}) {
  return (
    <figure className="relative order-first md:order-last">
      <div className="relative aspect-[4/5] max-h-[26rem] w-full rotate-2 overflow-hidden rounded-tile border-2 border-night bg-night shadow-[5px_6px_0_0_var(--color-night)] max-md:aspect-[4/3]">
        <EventVisual poster={poster} artists={artists} label={label} priority />
      </div>
      {caption && (
        <figcaption className="absolute -bottom-3 left-3">
          <span className="inline-block -rotate-3 rounded-chip border-2 border-night bg-lime px-3 py-1 text-sm font-bold text-on-block">
            🎤 {caption}
          </span>
        </figcaption>
      )}
      {credit && <p className="mt-3 text-right text-[0.6875rem] opacity-70">📷 {credit}</p>}
    </figure>
  );
}
