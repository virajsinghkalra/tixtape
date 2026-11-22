"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  ARTISTS,
  artistKey,
  LANDED_SEEN,
  landedShows,
  MAX_ARTIST_CHECKS,
  SAVED,
  upcomingSaved,
  type LandedShow,
} from "./device/device-lists";
import { useDeviceList } from "./device/use-device-list";
import { SAVE_COPY } from "./saved/save-copy";
import { ShowRow } from "./ShowRow";
import { SPRING_SOFT } from "./ui/motion";
import { COPY, justLanded } from "./ux-copy";

const SearchBody = z.object({
  results: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        startsAt: z.string(),
        city: z.string().nullable().default(null),
      }),
    )
    .default([]),
});

type Shows = Map<string, LandedShow["event"][]>;

/** One cheap `GET /api/search?artist=` per followed artist (max 5), after paint. */
async function upcomingByArtist(names: string[], signal: AbortSignal): Promise<Shows> {
  const from = new Date().toISOString();
  const found = await Promise.all(
    names.map(async (name) => {
      try {
        const params = new URLSearchParams({ artist: name, from, pageSize: "3" });
        const res = await fetch(`/api/search?${params}`, { signal });
        const body = SearchBody.safeParse(res.ok ? await res.json() : null);
        return [artistKey(name), body.success ? body.data.results : []] as [
          string,
          LandedShow["event"][],
        ];
      } catch {
        return [artistKey(name), []] as [string, LandedShow["event"][]];
      }
    }),
  );
  return new Map(found);
}

/**
 * "Your gigs" (UX #12, OD-9: a home row, no /me page yet; D-088). Everything comes from this
 * device: saved shows still to come, and "🎉 X just landed" when an artist the visitor pinged
 * or followed now has a show. Renders nothing for a first-time visitor.
 */
export function YourGigs() {
  const saved = useDeviceList(SAVED);
  const artists = useDeviceList(ARTISTS);
  const seen = useDeviceList(LANDED_SEEN);
  const reduceMotion = useReducedMotion();
  const [shows, setShows] = useState<Shows>(new Map());

  const names = useMemo(
    () => artists.items.slice(0, MAX_ARTIST_CHECKS).map((a) => a.name),
    [artists.items],
  );
  const namesKey = names.join("\n");
  useEffect(() => {
    if (names.length === 0) return;
    const controller = new AbortController();
    // After paint: never competes with the page's own requests.
    const timer = setTimeout(() => {
      void upcomingByArtist(names, controller.signal).then((m) => {
        if (!controller.signal.aborted) setShows(m);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `namesKey` stands for `names`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  if (!saved.ready) return null;
  const upcoming = upcomingSaved(saved.items, new Date());
  const hidden = new Set([...seen.items, ...saved.items.map((s) => s.id)]);
  const landed = landedShows(artists.items, shows, hidden).slice(0, 2);
  if (upcoming.length === 0 && landed.length === 0) return null;

  return (
    <section aria-label={COPY.yourGigs} className="mx-auto mt-10 max-w-6xl space-y-4 px-4 sm:px-6">
      <AnimatePresence initial={false}>
        {landed.map((l) => (
          <motion.div
            key={l.event.id}
            layout
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={reduceMotion ? { duration: 0.12 } : SPRING_SOFT}
            className="flex items-center gap-2 rounded-card border-2 border-night bg-lime p-2 pl-4 text-on-block shadow-[3px_4px_0_0_var(--color-night)]"
          >
            <Link
              href={`/events/${l.event.id}`}
              onClick={() => seen.add(l.event.id)}
              className="min-h-11 min-w-0 flex-1 py-1"
            >
              <span className="block truncate font-display text-lg font-extrabold">
                <span aria-hidden>🎉 </span>
                {justLanded(l.artist)}
              </span>
              <span className="block truncate text-sm font-semibold">{l.event.title}</span>
            </Link>
            <button
              type="button"
              onClick={() => seen.add(l.event.id)}
              aria-label={`${COPY.dismiss}: ${justLanded(l.artist)}`}
              className="grid size-11 shrink-0 place-items-center rounded-full text-xl hover:bg-night/10"
            >
              <span aria-hidden>×</span>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
      <ShowRow
        title={COPY.yourGigs}
        emoji="♥"
        aside={
          <Link
            href="/me/gigs"
            className="text-sm font-semibold underline-offset-4 hover:underline"
          >
            {SAVE_COPY.seeAll} <span aria-hidden>→</span>
          </Link>
        }
        items={upcoming.map((s) => ({
          id: s.id,
          title: s.title,
          startsAt: s.startsAt,
          city: s.city,
        }))}
      />
    </section>
  );
}
