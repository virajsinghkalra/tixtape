"use client";

import { eventTone } from "../event-color";
import { formatDateRange } from "../event-format";
import { cx } from "../ui/cx";
import { Skeleton } from "../ui/Skeleton";
import { TONE_CLASS } from "../ui/tone";
import type { EventResult } from "./types";

/**
 * Shown the instant a result is opened, with the title, date and city the suggestion already
 * had, while the event page loads (D-048 C). It goes away when the new page replaces this one.
 */
export function EventShell({ event }: { event: EventResult }) {
  return (
    <div aria-busy="true" className="fixed inset-0 z-[65] overflow-y-auto bg-bg px-4 pt-20 sm:px-6">
      <p className="sr-only">Opening {event.title}…</p>
      <div aria-hidden className="mx-auto max-w-6xl">
        <div className={cx("rounded-tile p-5 sm:p-7", TONE_CLASS[eventTone(event.id)])}>
          <p className="font-display text-mega font-extrabold tracking-tight">{event.title}</p>
          <p className="mt-4 text-lg font-semibold">
            {formatDateRange(new Date(event.startsAt), null)}
            {event.city ? ` · ${event.city}` : ""}
          </p>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_24rem]">
          <Skeleton className="h-96" />
          <Skeleton className="h-72" />
        </div>
      </div>
    </div>
  );
}
