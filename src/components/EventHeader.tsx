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
import type { CSSProperties } from "react";
import { EqBars } from "./ui/EqBars";
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
  /** The playlist's first songs: shown in the header as chips that play it. */
  inside?: { name: string; artist: string }[];
};

/** Long titles step down a size so they never stack into four giant lines. */
const H1: Record<TitleSize, string> = { xl: "text-mega", lg: "text-huge", md: "text-big" };

/**
 * Event page header (UX #5): back link, the picture, stickers, the title and one facts row.
 * Desktop gets the one Play button here; phones get it in the sticky bottom bar.
 */
export function EventHeader({
  event,
  now,
  playUrl = null,
  fallbackPlay = null,
  inside = [],
}: Props) {
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
          playable={Boolean(playUrl)}
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
          {/* Playlist first (user, 24 Nov): what's on it, before anything else, one tap to play. */}
          {playUrl && inside.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-extrabold tracking-wide uppercase opacity-80">
                <span aria-hidden>🎧 </span>On the gig playlist
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {inside.slice(0, 3).map((t, i) => (
                  <li
                    key={`${t.name}-${i}`}
                    className="pop-in"
                    style={{ "--i": i + 2 } as CSSProperties}
                  >
                    <a
                      href={playUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-track="playlist_open_spotify"
                      data-track-event={event.id}
                      className="inline-flex min-h-10 max-w-[15rem] items-center gap-1.5 rounded-chip border-2 border-night bg-surface px-3 py-1 text-sm font-bold text-ink shadow-[2px_3px_0_0_var(--color-night)] transition-transform hover:-translate-y-0.5 active:scale-95"
                    >
                      <span aria-hidden className="text-accent-text">
                        ▶
                      </span>
                      <span className="truncate">{t.name.replace(/\s*[([].*$/u, "")}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
  playable,
}: {
  poster: string | null | undefined;
  artists: VisualArtist[];
  label: string;
  caption: string | null;
  /** D-083: shown tiny under the picture when the poster needs attribution. */
  credit: string | null;
  /** The gig has a playlist: the picture becomes an album sleeve with its record sliding out. */
  playable: boolean;
}) {
  return (
    <figure className="relative order-first md:order-last">
      {playable && (
        <div aria-hidden className="vinyl-out absolute top-[6%] right-0 bottom-[6%] aspect-square">
          <div className="vinyl-disc relative h-full rounded-full border-2 border-night bg-[repeating-radial-gradient(circle,#16161c_0_2px,#0b0b0f_2px_5px)] shadow-[4px_5px_0_0_var(--color-night)]">
            <span className="absolute top-1/2 left-1/2 grid size-[34%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-night bg-lime text-[0.6rem] font-extrabold text-on-block">
              tixtape
            </span>
          </div>
        </div>
      )}
      <div
        className={cx(
          "relative z-10 aspect-[4/5] max-h-[26rem] rotate-2 overflow-hidden rounded-tile border-2 border-night bg-night shadow-[5px_6px_0_0_var(--color-night)] max-md:aspect-[4/3]",
          playable ? "w-[82%]" : "w-full",
        )}
      >
        <EventVisual poster={poster} artists={artists} label={label} priority />
        {playable && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-chip border-2 border-night bg-lime px-2.5 py-0.5 text-xs font-extrabold text-on-block shadow-[2px_3px_0_0_var(--color-night)]">
            <EqBars /> GIG PLAYLIST
          </span>
        )}
      </div>
      {caption && (
        <figcaption className="absolute -bottom-3 left-3 z-20">
          <span className="inline-block -rotate-3 rounded-chip border-2 border-night bg-lime px-3 py-1 text-sm font-bold text-on-block">
            🎤 {caption}
          </span>
        </figcaption>
      )}
      {credit && <p className="mt-3 text-right text-[0.6875rem] opacity-70">📷 {credit}</p>}
    </figure>
  );
}
