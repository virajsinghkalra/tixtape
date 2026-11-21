import type { EventDetail } from "@/application/ports/events";
import { eventTone } from "./event-color";
import { EventVisual } from "./EventVisual";
import { formatDateRange, formatStartTime } from "./event-format";
import { shareText, titleSize, type TitleSize } from "./lineup-copy";
import { ShareButton } from "./ShareButton";
import { cx } from "./ui/cx";
import { ButtonLink } from "./ui/Button";
import { Countdown } from "./ui/Countdown";
import { Sticker } from "./ui/Sticker";
import { Tile } from "./ui/Tile";

const STATUS: Record<EventDetail["status"], { emoji: string; label: string }> = {
  announced: { emoji: "📣", label: "Announced" },
  partial_lineup: { emoji: "🧩", label: "Lineup dropping" },
  full_lineup: { emoji: "✅", label: "Full lineup" },
  cancelled: { emoji: "🚫", label: "Cancelled" },
};

type Props = { event: EventDetail; ticketUrl: string | null; now: Date };

/** Long titles step down a size so they never stack into four giant lines. */
const H1: Record<TitleSize, string> = { xl: "text-mega", lg: "text-huge", md: "text-big" };

/** Event page header: back link, stickers, the title as a loud block, and the key facts. */
export function EventHeader({ event, ticketUrl, now }: Props) {
  const status = STATUS[event.status];
  const where = event.venue ? `${event.venue.name}, ${event.venue.city}` : "Venue TBA";
  const solo = event.lineup.length === 1 ? event.lineup[0]! : null;
  const ordered = [...event.lineup].sort((a, b) => a.billingRank - b.billingRank);
  const names = ordered.map((a) => a.name);
  const top = ordered.filter((a) => a.tier === ordered[0]?.tier);
  return (
    <header>
      <ButtonLink href="/" variant="ghost" className="-ml-3">
        <span aria-hidden>←</span> All events
      </ButtonLink>
      <Tile
        tone={eventTone(event.id)}
        className="pop-in mt-3 grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center"
      >
        <HeroPicture
          poster={event.posterUrl}
          faces={top.map((a) => a.imageUrl)}
          label={names[0] ?? event.title}
          caption={solo?.name ?? null}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Countdown
              startsAt={event.startsAt.toISOString()}
              endsAt={event.endsAt?.toISOString() ?? null}
              now={now.toISOString()}
              size="md"
            />
            <Sticker
              tone="night"
              tilt={2}
              size="md"
              emoji={event.type === "festival" ? "🎪" : "🎤"}
            >
              {event.type === "festival" ? "Festival" : "Concert"}
            </Sticker>
            <Sticker tone="surface" tilt={-2} size="md" emoji={status.emoji}>
              {status.label}
            </Sticker>
          </div>
          <h1
            className={cx(
              "mt-5 font-display font-extrabold tracking-tight text-balance [overflow-wrap:anywhere]",
              H1[titleSize(event.title)],
            )}
          >
            {event.title}
          </h1>
          <dl className="mt-6 grid gap-4 sm:grid-cols-3">
            <Fact term="When" value={formatDateRange(event.startsAt, event.endsAt)} />
            <Fact term="Starts" value={formatStartTime(event.startsAt)} />
            <Fact term="Where" value={where} />
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="#playlist" variant="night" size="lg">
              <span aria-hidden>🎧</span> Get the playlist
            </ButtonLink>
            {ticketUrl && (
              <ButtonLink href={ticketUrl} external variant="secondary" size="lg">
                <span aria-hidden>🎟️</span> Buy tickets
              </ButtonLink>
            )}
            <ShareButton title={event.title} text={shareText(event.title, names)} size="lg" />
          </div>
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
  faces,
  label,
  caption,
}: {
  poster: string | null | undefined;
  faces: (string | null)[];
  label: string;
  caption: string | null;
}) {
  return (
    <figure className="relative order-first md:order-last">
      <div className="relative aspect-[4/3] w-full rotate-2 overflow-hidden rounded-tile border-2 border-night bg-night shadow-[5px_6px_0_0_var(--color-night)] md:aspect-square">
        <EventVisual poster={poster} faces={faces} label={label} />
      </div>
      {caption && (
        <figcaption className="absolute -bottom-3 left-3">
          <span className="inline-block -rotate-3 rounded-chip border-2 border-night bg-lime px-3 py-1 text-sm font-bold text-on-block">
            🎤 {caption}
          </span>
        </figcaption>
      )}
    </figure>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-sm font-bold">{term}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
