"use client";

import Link from "next/link";
import { calendarEventOf, googleCalendarUrl } from "@/domain/events/calendar";
import { SAVED, upcomingSaved, type SavedShow } from "../device/device-lists";
import { useDeviceList } from "../device/use-device-list";
import { RemindMe } from "../RemindMe";
import { shortWhen } from "../ShowRow";
import { buttonClass } from "../ui/Button";
import { SAVE_COPY } from "./save-copy";

function googleHref(s: SavedShow): string {
  return googleCalendarUrl(
    calendarEventOf(
      {
        id: s.id,
        title: s.title,
        type: "concert",
        startsAt: new Date(s.startsAt),
        endsAt: null,
        venue: null,
      },
      window.location.origin,
    ),
  );
}

function Row({ show, past }: { show: SavedShow; past: boolean }) {
  return (
    <li className="flex flex-col gap-3 rounded-card border-2 border-night bg-surface p-4 shadow-[3px_4px_0_0_var(--color-night)] dark:border-line">
      <Link href={`/events/${show.id}`} className="min-w-0">
        <span className="block truncate font-display text-lg font-extrabold">{show.title}</span>
        <span className="block text-sm text-muted">{shortWhen(show.startsAt, show.city)}</span>
      </Link>
      <div className="flex flex-wrap gap-2">
        {!past && (
          <RemindMe
            eventId={show.id}
            icsHref={`/api/events/${show.id}/calendar.ics`}
            googleHref={googleHref(show)}
          />
        )}
        <Link href={`/events/${show.id}#playlist`} className={buttonClass("secondary", "md")}>
          <span aria-hidden>🎧</span> {SAVE_COPY.openPlaylist}
        </Link>
      </div>
    </li>
  );
}

/** D-092: "Your gigs": upcoming saved shows first, then "Been there ✓". */
export function YourGigsPage() {
  const saved = useDeviceList(SAVED);
  const upcoming = saved.ready ? upcomingSaved(saved.items, new Date()) : [];
  const ahead = new Set(upcoming.map((s) => s.id));
  const past = saved.items
    .filter((s) => !ahead.has(s.id))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6">
      <h1 className="font-display text-huge font-extrabold">
        {SAVE_COPY.pageTitle} <span aria-hidden>♥</span>
      </h1>
      {saved.ready && saved.items.length === 0 && (
        <div className="flex flex-col items-start gap-4">
          <p className="font-display text-xl font-extrabold">{SAVE_COPY.empty}</p>
          <Link href="/search" className={buttonClass("primary", "md")}>
            {SAVE_COPY.findGigs} <span aria-hidden>→</span>
          </Link>
        </div>
      )}
      {upcoming.length > 0 && (
        <ul className="flex flex-col gap-3">
          {upcoming.map((s) => (
            <Row key={s.id} show={s} past={false} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <section className="flex flex-col gap-3" aria-label={SAVE_COPY.beenThere}>
          <h2 className="font-display text-xl font-extrabold">{SAVE_COPY.beenThere}</h2>
          <ul className="flex flex-col gap-3 opacity-80">
            {past.map((s) => (
              <Row key={s.id} show={s} past />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
