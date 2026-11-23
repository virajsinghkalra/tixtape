import type { FeedRow } from "@/application/ports/event-feed";
import { FrontSection } from "@/components/FrontSection";
import { groupTours } from "@/domain/events/front-page";
import { splitByCity } from "./browse";
import { CompactList } from "./CompactList";

type Props = {
  emoji: string;
  title: string;
  empty: string;
  rows: FeedRow[];
  now: Date;
  city: string | null;
};

/**
 * A browse list (ready / week / upcoming): the visitor's city as a swipeable rail of cards,
 * then everything else as compact month-grouped rows, one row per tour (user feedback, 24 Nov).
 */
export function BrowsePage({ emoji, title, empty, rows, now, city }: Props) {
  const { here, other } = splitByCity(rows, city);
  const soonest = (xs: ReturnType<typeof groupTours<FeedRow>>) =>
    [...xs].sort(
      (a, b) =>
        (a.kind === "event" ? a.event : a.tour.featured).startsAt.getTime() -
        (b.kind === "event" ? b.event : b.tour.featured).startsAt.getTime(),
    );
  const local = soonest(groupTours(here, city, now));
  const rest = soonest(groupTours(other, city, now));
  return (
    <div className="pb-16">
      <h1 className="mx-auto mt-8 max-w-6xl px-4 font-display text-mega font-extrabold tracking-tight sm:px-6">
        <span aria-hidden className="mr-2">
          {emoji}
        </span>
        {title}
      </h1>
      {rows.length === 0 && (
        <p className="mx-auto mt-6 max-w-6xl px-4 text-muted sm:px-6">{empty}</p>
      )}
      {city && (
        <FrontSection
          id="here"
          emoji="📍"
          title={city}
          items={local}
          now={now}
          city={city}
          layout="row"
        />
      )}
      {rest.length > 0 && (
        <section aria-labelledby="more-title" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
          <h2 id="more-title" className="mb-5 font-display text-big font-extrabold tracking-tight">
            <span aria-hidden className="mr-2">
              🇮🇳
            </span>
            {local.length > 0 ? "Explore more" : "All India"}
          </h2>
          <CompactList items={rest} now={now} />
        </section>
      )}
    </div>
  );
}
