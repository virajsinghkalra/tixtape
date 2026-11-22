import type { FeedRow } from "@/application/ports/event-feed";
import { FrontSection } from "@/components/FrontSection";
import { splitByCity } from "./browse";

type Props = {
  emoji: string;
  title: string;
  empty: string;
  rows: FeedRow[];
  now: Date;
  city: string | null;
};

/** A flat browse list (ready / week / upcoming): the visitor's city first, then "Explore more 🇮🇳". */
export function BrowsePage({ emoji, title, empty, rows, now, city }: Props) {
  const { here, other } = splitByCity(rows, city);
  const items = (xs: FeedRow[]) => xs.map((event) => ({ kind: "event" as const, event, score: 0 }));
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
        <FrontSection id="here" emoji="📍" title={city} items={items(here)} now={now} city={city} />
      )}
      <FrontSection
        id="more"
        emoji="🇮🇳"
        title={here.length > 0 ? "Explore more" : "All India"}
        items={items(other)}
        now={now}
        city={city}
      />
    </div>
  );
}
