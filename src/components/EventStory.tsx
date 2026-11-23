import type { EventDetail } from "@/application/ports/events";
import { countdownBadge, formatDateRange, istDayCount } from "./event-format";
import { introLine, STORY_HEADER } from "./lineup-copy";
import { orderForVisuals } from "@/domain/visuals/visuals";
import { ArtistChip, AvatarStack } from "./ArtistAvatar";
import { isMatched } from "./lineup-view";
import { planStory } from "./story-plan";
import { renderStory } from "./StorySlides";
import { StoryViewer } from "./ui/StoryViewer";
import { vibeOf } from "./vibe-copy";
import { VibeChip } from "./VibeChip";

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
  const vibe = vibeOf(event.genre, event.type);
  const plan = planStory({
    id: event.id,
    title: event.title,
    dateLine: formatDateRange(event.startsAt, event.endsAt),
    city: event.venue?.city ?? null,
    badge: countdownBadge(event.startsAt, event.endsAt, now),
    artists: lineup,
    poster: event.posterUrl,
    playlistHref: "#playlist",
    eventHref: null,
    matched: lineup.filter((a) => isMatched(a.matchStatus)).length,
    vibe,
  });
  const visual = orderForVisuals(lineup);
  const wall = visual.slice(0, WALL);
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
          <VibeChip vibe={vibe} seed={event.id} solo={lineup.length === 1} size="lg" link />
          {lineup.length > 1 && (
            <ul aria-label="Who's playing" className="flex flex-wrap gap-3">
              {wall.map((a, i) => (
                <li key={a.artistId} style={{ rotate: `${((i % 3) - 1) * 2}deg` }}>
                  <ArtistChip artist={a} size="sm" index={i} className="dark:border-line" />
                </li>
              ))}
              {lineup.length > WALL && (
                <li>
                  <a href="#lineup" aria-label={`${lineup.length - WALL} more on the lineup`}>
                    <AvatarStack
                      artists={visual.slice(WALL, WALL + 3)}
                      more={lineup.length - WALL}
                    />
                  </a>
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
