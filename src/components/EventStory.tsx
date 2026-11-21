import type { EventDetail } from "@/application/ports/events";
import { countdownBadge, formatDateRange, istDayCount } from "./event-format";
import { introLine, STORY_CTA, STORY_HEADER } from "./lineup-copy";
import { isMatched } from "./lineup-view";
import { planStory } from "./story-plan";
import { renderStory } from "./StorySlides";
import { ButtonLink } from "./ui/Button";
import { StoryViewer } from "./ui/StoryViewer";

type Props = {
  event: EventDetail;
  now: Date;
};

/** How many artist photos the side column shows. */
const WALL = 12;

/**
 * "The rundown": the event as a phone-shaped story card (never a full-width banner), with a
 * side column on wide screens so there is no empty space next to it.
 */
export function EventStory({ event, now }: Props) {
  const lineup = [...event.lineup].sort((a, b) => a.billingRank - b.billingRank);
  const days = istDayCount(event.startsAt, event.endsAt);
  const plan = planStory({
    id: event.id,
    title: event.title,
    dateLine: formatDateRange(event.startsAt, event.endsAt),
    city: event.venue?.city ?? null,
    badge: countdownBadge(event.startsAt, event.endsAt, now),
    artists: lineup.map((a) => ({
      name: a.name,
      imageUrl: a.imageUrl,
      tier: a.tier,
      billingRank: a.billingRank,
    })),
    poster: event.posterUrl,
    playlistHref: "#playlist",
    eventHref: null,
    matched: lineup.filter((a) => isMatched(a.matchStatus)).length,
  });
  const wall = lineup.slice(0, WALL);
  return (
    <section aria-labelledby="rundown-title">
      <h2 id="rundown-title" className="mb-4 font-display text-big font-extrabold">
        {STORY_HEADER}
      </h2>
      <div className="grid items-center gap-8 lg:grid-cols-[440px_minmax(0,1fr)]">
        <StoryViewer
          title={`${event.title}: ${plan.heading}`}
          slides={renderStory(event.id, plan)}
          className="mx-auto aspect-[3/5] w-full max-w-[440px] border-2 border-night shadow-[5px_6px_0_0_var(--color-night)] lg:mx-0"
        />
        <div className="hidden flex-col gap-6 lg:flex">
          <p className="font-display text-huge leading-[0.95] font-extrabold text-balance">
            {introLine(
              lineup.map((a) => a.name),
              lineup.length,
              days,
            )}
          </p>
          {lineup.length > 1 && (
            <ul aria-label="Who's playing" className="flex flex-wrap gap-3">
              {wall.map((a, i) => (
                <li
                  key={a.artistId}
                  className="flex items-center gap-2 rounded-chip border-2 border-night bg-surface py-1 pr-4 pl-1 font-semibold shadow-[2px_3px_0_0_var(--color-night)] dark:border-line"
                  style={{ rotate: `${((i % 3) - 1) * 2}deg` }}
                >
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-violet bg-cover bg-[center_10%] font-display font-extrabold text-white"
                    style={a.imageUrl ? { backgroundImage: `url("${a.imageUrl}")` } : undefined}
                  >
                    {a.imageUrl ? "" : a.name.charAt(0)}
                  </span>
                  {a.name}
                </li>
              ))}
              {lineup.length > WALL && (
                <li className="flex items-center px-2 font-bold">+ {lineup.length - WALL} more</li>
              )}
            </ul>
          )}
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="#playlist" size="lg">
              <span aria-hidden>🎧</span> {STORY_CTA.playlist}
            </ButtonLink>
            {lineup.length > 1 && (
              <ButtonLink href="#lineup" variant="secondary" size="lg">
                Full lineup <span aria-hidden>↓</span>
              </ButtonLink>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
