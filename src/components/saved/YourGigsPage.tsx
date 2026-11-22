"use client";

import Link from "next/link";
import { calendarEventOf, googleCalendarUrl } from "@/domain/events/calendar";
import { SAVED, upcomingSaved, type SavedShow } from "../device/device-lists";
import { useDeviceList } from "../device/use-device-list";
import { RemindMe } from "../RemindMe";
import { shortWhen } from "../ShowRow";
import { buttonClass } from "../ui/Button";
import { haptic } from "../ui/feedback";
import { useToast } from "../ui/Toast";
import { SAVE_COPY } from "./save-copy";
import { noteUnsave } from "./saved-sync";

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

function Row({
  show,
  past,
  onRemove,
}: {
  show: SavedShow;
  past: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-card border-2 border-night bg-surface p-4 shadow-[3px_4px_0_0_var(--color-night)] dark:border-line">
      <div className="flex items-start gap-2">
        <Link href={`/events/${show.id}`} className="min-w-0 flex-1">
          <span className="block truncate font-display text-lg font-extrabold">{show.title}</span>
          <span className="block text-sm text-muted">{shortWhen(show.startsAt, show.city)}</span>
        </Link>
        <button
          type="button"
          onClick={() => onRemove(show.id)}
          aria-label={`${SAVE_COPY.remove} ${show.title}`}
          className="-mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-surface-2 hover:text-ink"
        >
          <span aria-hidden>×</span>
        </button>
      </div>
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
  const toast = useToast();
  const remove = (id: string) => {
    saved.remove(id);
    noteUnsave(id, new Date().toISOString());
    haptic("tap");
    toast.show(SAVE_COPY.removed);
  };
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
            <Row key={s.id} show={s} past={false} onRemove={remove} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <section className="flex flex-col gap-3" aria-label={SAVE_COPY.beenThere}>
          <h2 className="font-display text-xl font-extrabold">{SAVE_COPY.beenThere}</h2>
          <ul className="flex flex-col gap-3 opacity-80">
            {past.map((s) => (
              <Row key={s.id} show={s} past onRemove={remove} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
