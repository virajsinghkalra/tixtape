import Link from "next/link";
import type { CSSProperties } from "react";
import type { FeedRow } from "@/application/ports/event-feed";
import type { FrontItem } from "@/domain/events/front-page";
import { istParts, yearTag } from "../event-format";
import { shortTitle } from "../hero-copy";
import { SpotifyOpenLink } from "../SpotifyOpenLink";
import { cx } from "../ui/cx";
import { vibeEmoji, vibeOf } from "../vibe-copy";

const lead = (i: FrontItem<FeedRow>) => (i.kind === "event" ? i.event : i.tour.featured);

/**
 * A long browse list as compact rows grouped by month (user feedback, 24 Nov: /upcoming was
 * ~47,000px of big cards). A tour is one row linking to its tour page; every row with a
 * playlist has a round Play.
 */
export function CompactList({
  items,
  now,
  newestFirst = false,
}: {
  items: FrontItem<FeedRow>[];
  now: Date;
  newestFirst?: boolean;
}) {
  const sign = newestFirst ? -1 : 1;
  const sorted = [...items].sort(
    (a, b) => sign * (lead(a).startsAt.getTime() - lead(b).startsAt.getTime()),
  );
  const months = new Map<string, FrontItem<FeedRow>[]>();
  for (const item of sorted) {
    const { month } = istParts(lead(item).startsAt);
    const key = `${month} ${yearTag(lead(item).startsAt, now)}`;
    months.set(key, [...(months.get(key) ?? []), item]);
  }
  return (
    <div className="flex flex-col gap-8">
      {[...months].map(([month, group]) => (
        <section key={month} aria-label={month} className="reveal">
          <h3 className="sticky top-16 z-10 -mx-1 mb-3 inline-flex rounded-chip border-2 border-night bg-lime px-3 py-1 font-display text-lg font-extrabold text-on-block shadow-[2px_3px_0_0_var(--color-night)]">
            {month}
          </h3>
          <ol className="flex flex-col gap-2.5">
            {group.map((item, i) => (
              <li key={item.kind === "event" ? item.event.id : item.tour.key} className="relative">
                <Row item={item} i={i} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Row({ item, i }: { item: FrontItem<FeedRow>; i: number }) {
  const e = lead(item);
  const { day, weekday } = istParts(e.startsAt);
  const tour = item.kind === "tour" ? item.tour : null;
  const artist = e.headliners[0];
  const title = tour && artist ? artist : shortTitle(e.title, artist);
  const href = tour && artist ? `/search?artist=${encodeURIComponent(artist)}` : `/events/${e.id}`;
  const sub = tour
    ? `🗺️ ${tour.cityCount > 1 ? `${tour.cityCount} cities` : `${tour.events.length} dates`} · next: ${e.city ?? "TBA"}`
    : [e.venue?.city, e.venue?.name].filter(Boolean).join(" · ");
  const vibe = vibeOf(e.genre, e.type);
  return (
    <div
      data-vibe={vibe}
      style={{ "--i": Math.min(i, 8) } as CSSProperties}
      className="pop-in flex items-center gap-3 rounded-field border-2 border-night bg-surface p-2 shadow-[3px_4px_0_0_var(--color-night)] transition-[translate,box-shadow] duration-(--duration-base) ease-spring hover:-translate-y-0.5 hover:shadow-[4px_6px_0_0_var(--color-night)] dark:border-line"
    >
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-12 shrink-0 flex-col items-center justify-center rounded-[10px] border-2 border-night bg-night leading-none text-lime">
          <span className="font-display text-lg font-extrabold">{day}</span>
          <span className="text-[0.6rem] font-bold uppercase">{weekday}</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-base leading-tight font-extrabold">
            <span aria-hidden>{vibeEmoji(vibe)} </span>
            {title}
          </span>
          <span className="block truncate text-xs text-muted">{sub}</span>
        </span>
      </Link>
      {e.playlistUrl ? (
        <SpotifyOpenLink
          href={e.playlistUrl}
          eventId={e.id}
          size="md"
          className={cx("w-auto shrink-0 [&>a]:size-11 [&>a]:rounded-full [&>a]:p-0")}
        >
          <span aria-hidden className="translate-x-px leading-none">
            ▶
          </span>
          <span className="sr-only">Play {title}</span>
        </SpotifyOpenLink>
      ) : (
        <span aria-hidden className="px-2 text-lg text-muted">
          →
        </span>
      )}
    </div>
  );
}
