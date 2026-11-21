import Link from "next/link";
import type { FeedRow } from "@/application/ports/event-feed";
import { metroOf, type FrontItem, type Tour } from "@/domain/events/front-page";
import { EventCard, type TourInfo } from "./EventCard";
import { istParts } from "./event-format";
import { plural } from "./lineup-copy";
import { Section } from "./Section";
import { cx } from "./ui/cx";

type Props = {
  id: string;
  emoji: string;
  title: string;
  blurb?: string;
  items: FrontItem<FeedRow>[];
  now: Date;
  /** Where "See all" goes, so nothing on the home page is a dead end (D-079). */
  seeAll: string;
  city: string | null;
  layout?: "grid" | "row";
};

/** One ranked home section (D-079): cards (one per tour) and a "See all" link. */
export function FrontSection({
  id,
  emoji,
  title,
  blurb,
  items,
  now,
  seeAll,
  city,
  layout = "grid",
}: Props) {
  if (items.length === 0) return null;
  const row = layout === "row";
  return (
    <Section
      id={id}
      emoji={emoji}
      title={title}
      blurb={blurb}
      aside={
        <Link
          href={seeAll}
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-chip px-3 text-sm font-semibold text-accent-text hover:underline"
        >
          See all <span aria-hidden>→</span>
        </Link>
      }
    >
      <ul
        className={cx(
          row
            ? "no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pt-1 pb-3 [contain:paint] sm:-mx-6 sm:px-6"
            : "grid gap-5 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {items.map((item, i) => {
          const lead = item.kind === "event" ? item.event : item.tour.featured;
          return (
            <li
              key={item.kind === "event" ? item.event.id : item.tour.key}
              className={row ? "w-[78%] shrink-0 snap-start sm:w-[20rem]" : undefined}
            >
              <EventCard
                event={lead}
                now={now}
                index={i}
                variant={row ? "compact" : "feed"}
                headliners={lead.headliners}
                artists={lead.headlinerArtists}
                ticketUrl={lead.ticketUrl}
                tour={item.kind === "tour" ? tourInfo(item.tour, city) : undefined}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

const shortDate = (d: Date) => {
  const { day, month } = istParts(d);
  return `${day} ${month}`;
};

/** "10 cities · nearest: Mumbai · 21 Mar", with every stop listed. */
export function tourInfo(tour: Tour<FeedRow>, visitorCity: string | null): TourInfo {
  const f = tour.featured;
  const near = visitorCity && f.city && metroOf(f.city) === metroOf(visitorCity);
  return {
    count:
      tour.cityCount > 1
        ? plural(tour.cityCount, "city", "cities")
        : plural(tour.events.length, "date"),
    featuredLine: `${near ? "nearest" : "next"}: ${f.city ?? "TBA"} · ${shortDate(f.startsAt)}`,
    stops: tour.events.map((e) => ({
      id: e.id,
      label: `${e.city ?? "TBA"} · ${shortDate(e.startsAt)}`,
    })),
  };
}
