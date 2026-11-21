import type { EventDetail } from "@/application/ports/events";
import { countdownBadge, formatDateRange } from "./event-format";
import type { PlaylistPreview } from "./playlist-preview";
import { planStory } from "./story-plan";
import { renderStory } from "./StorySlides";
import { StoryViewer } from "./ui/StoryViewer";

type Props = {
  event: EventDetail;
  now: Date;
  /** The same engine preview as the playlist panel (D-065), so both always agree. */
  preview: PlaylistPreview | null;
};

/** The event as a Wrapped-style story, shaped by the lineup size (see `planStory`). */
export function EventStory({ event, now, preview }: Props) {
  const plan = planStory({
    id: event.id,
    title: event.title,
    dateLine: formatDateRange(event.startsAt, event.endsAt),
    city: event.venue?.city ?? null,
    badge: countdownBadge(event.startsAt, event.endsAt, now),
    artists: event.lineup.map((a) => ({
      name: a.name,
      imageUrl: a.imageUrl,
      tier: a.tier,
      billingRank: a.billingRank,
    })),
    preview,
    playlistHref: "#playlist",
    eventHref: null,
  });
  return (
    <div>
      <h2 className="font-display text-big font-extrabold">{plan.heading}</h2>
      <p className="mt-1 mb-4 text-muted">Swipe, or use the arrows.</p>
      <StoryViewer
        title={plan.heading}
        slides={renderStory(event.id, plan)}
        className="border-2 border-night shadow-[5px_6px_0_0_var(--color-night)]"
      />
    </div>
  );
}
