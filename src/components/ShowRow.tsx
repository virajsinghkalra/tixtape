"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArtistAvatar } from "./ArtistAvatar";
import { shortDate } from "./event-format";
import { EASE_OUT_EXPO } from "./ui/motion";

export type ShowRowItem = {
  id: string;
  title: string;
  /** ISO instant. */
  startsAt: string;
  city: string | null;
  /** Pictured on the card when known (a similar artist, a followed artist). */
  artist?: string;
};

/** "22 Nov · Mumbai". */
export function shortWhen(startsAt: string, city: string | null): string {
  const d = new Date(startsAt);
  const when = Number.isNaN(d.getTime()) ? "" : shortDate(d);
  return [when, city].filter(Boolean).join(" · ");
}

/**
 * A titled, horizontally snapping row of small show cards (UX #7 discovery rows, #12 "Your
 * gigs"). At most 6 cards; rows fade up 12 px, staggered (reduced motion: a quick fade).
 */
export function ShowRow({
  title,
  emoji,
  items,
  index = 0,
  onOpen,
  aside,
}: {
  title: string;
  emoji?: string;
  items: ShowRowItem[];
  /** Position among sibling rows, for the stagger. */
  index?: number;
  onOpen?: (item: ShowRowItem) => void;
  aside?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  if (items.length === 0) return null;
  return (
    <motion.section
      aria-label={title}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0.12 }
          : { duration: 0.25, ease: EASE_OUT_EXPO, delay: index * 0.06 }
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-extrabold">
          {emoji && (
            <span aria-hidden className="mr-2">
              {emoji}
            </span>
          )}
          {title}
        </h2>
        {aside}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {items.slice(0, 6).map((s) => (
          <li key={s.id} className="w-60 shrink-0 snap-start">
            <Link
              href={`/events/${s.id}`}
              onClick={() => onOpen?.(s)}
              className="flex h-full min-h-16 items-center gap-3 rounded-card border-2 border-night bg-surface p-3 text-ink shadow-[3px_4px_0_0_var(--color-night)] transition-transform hover:-translate-y-0.5 dark:border-line"
            >
              <ArtistAvatar
                artist={{ name: s.artist ?? s.title, imageUrl: null }}
                size="md"
                shape="rounded"
              />
              <span className="min-w-0">
                <span className="line-clamp-2 font-semibold leading-tight">{s.title}</span>
                <span className="mt-0.5 block truncate text-sm text-muted">
                  {s.artist ? `${s.artist} · ` : ""}
                  {shortWhen(s.startsAt, s.city)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}
