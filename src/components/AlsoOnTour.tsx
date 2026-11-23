import Link from "next/link";
import type { CSSProperties } from "react";
import { istParts, yearTag } from "./event-format";

export type TourStop = { id: string; city: string | null; startsAt: Date };

/**
 * "🗺️ Also on this tour": the artist's other dates as a swipeable row of chips, so a visitor
 * in the wrong city can jump to theirs (user feedback, 24 Nov: more to explore).
 */
export function AlsoOnTour({
  artist,
  stops,
  now,
}: {
  artist: string;
  stops: TourStop[];
  now: Date;
}) {
  if (stops.length === 0) return null;
  return (
    <section aria-labelledby="tour-title" className="reveal mt-10">
      <div className="flex items-end justify-between gap-3">
        <h2 id="tour-title" className="font-display text-big font-extrabold tracking-tight">
          <span aria-hidden className="mr-2">
            🗺️
          </span>
          Also on this tour
        </h2>
        <Link
          href={`/search?artist=${encodeURIComponent(artist)}`}
          className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-accent-text hover:underline"
        >
          All dates <span aria-hidden>&nbsp;→</span>
        </Link>
      </div>
      <ul className="no-scrollbar -mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pt-1 pb-3 sm:-mx-6 sm:px-6">
        {stops.map((s, i) => {
          const { day, month } = istParts(s.startsAt);
          return (
            <li
              key={s.id}
              className="pop-in relative shrink-0 snap-start"
              style={{ "--i": i } as CSSProperties}
            >
              <Link
                href={`/events/${s.id}`}
                className="vibe-tile flex min-h-11 items-center gap-2 rounded-chip border-2 border-night bg-surface py-1.5 pr-4 pl-1.5 font-semibold shadow-[2px_3px_0_0_var(--color-night)] dark:border-line"
              >
                <span className="rounded-chip bg-lime px-2 py-0.5 text-xs font-extrabold text-on-block">
                  {day} {month} {yearTag(s.startsAt, now)}
                </span>
                {s.city ?? "TBA"}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
