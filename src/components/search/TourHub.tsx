import Link from "next/link";
import type { CSSProperties } from "react";
import type { EventDetail } from "@/application/ports/events";
import type { PreviewTrack } from "@/application/ports/spotify";
import { inHomeCity } from "@/domain/events/search";
import { countdownBadge, istParts, yearTag } from "../event-format";
import { EventVisual } from "../EventVisual";
import { HeartButton } from "../HeartButton";
import { toSavedShowInput } from "../saved/save-show";
import { SpotifyOpenLink } from "../SpotifyOpenLink";
import { EqBars } from "../ui/EqBars";
import { cx } from "../ui/cx";
import { VibeChip } from "../VibeChip";
import { vibeOf } from "../vibe-copy";
import { VENUE_SOON, venueName } from "../venue";

type Props = {
  artist: string;
  shows: EventDetail[];
  homeCity: string | null;
  now: Date;
  playlist: { url: string; inside: PreviewTrack[] } | null;
};

/**
 * An artist's tour on one screen (user feedback, 24 Nov: 14 identical big cards). A header with
 * the artist, their vibe, a couple of songs and one "Play the tour playlist", then every date as
 * a compact row, the visitor's city first.
 */
export function TourHub({ artist, shows, homeCity, now, playlist }: Props) {
  const lead = shows[0]!;
  const vibe = vibeOf(lead.genre, lead.type);
  const headliner = lead.lineup.find((a) => a.name === artist) ?? lead.lineup[0];
  const cities = new Set(shows.map((s) => s.venue?.city).filter(Boolean)).size;
  // Soonest first, with the visitor's city on top.
  const byDate = [...shows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const isMine = (s: EventDetail) => inHomeCity(s.venue?.city ?? null, homeCity ?? "");
  const ordered = [...byDate.filter(isMine), ...byDate.filter((s) => !isMine(s))];
  const songs = (playlist?.inside ?? []).slice(0, 2).map((t) => t.name.replace(/\s*[([].*$/u, ""));

  return (
    <>
      <section
        aria-label={`${artist} tour`}
        data-vibe={vibe}
        className="pop-in mt-6 overflow-hidden rounded-card border-2 border-night bg-surface shadow-[4px_5px_0_0_var(--color-night)] dark:border-line"
      >
        <div className="relative h-56 bg-night sm:h-72">
          <EventVisual artists={headliner ? [headliner] : []} label={artist} priority />
          <div
            aria-hidden
            className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.92),rgb(11_11_15/0.15)_65%)]"
          />
          <span className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-chip border-2 border-night bg-lime px-2.5 py-0.5 text-xs font-bold text-on-block shadow-[2px_3px_0_0_var(--color-night)]">
            <span aria-hidden>🗺️</span> {cities > 1 ? `${cities} cities` : `${shows.length} dates`}
          </span>
          <p className="absolute inset-x-4 bottom-3 font-display text-huge leading-none font-extrabold text-white">
            {artist}
          </p>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <VibeChip vibe={vibe} seed={lead.id} solo />
          {songs.length > 0 && (
            <p className="text-sm">
              <span className="font-semibold text-muted">Inside </span>
              <span className="font-semibold">{songs.join(" · ")}</span>
              <span className="text-muted"> + more</span>
            </p>
          )}
          {playlist ? (
            <SpotifyOpenLink href={playlist.url} eventId={lead.id} size="lg">
              <EqBars /> Play the tour playlist
            </SpotifyOpenLink>
          ) : null}
        </div>
      </section>

      <h2 className="reveal mt-10 font-display text-big font-extrabold">Pick your city</h2>
      <ol className="mt-4 flex flex-col gap-3">
        {ordered.map((s, i) => {
          const { day, month } = istParts(s.startsAt);
          const mine = inHomeCity(s.venue?.city ?? null, homeCity ?? "");
          const badge = countdownBadge(s.startsAt, s.endsAt, now);
          return (
            <li
              key={s.id}
              className="pop-in relative"
              style={{ "--i": Math.min(i, 10) } as CSSProperties}
            >
              <Link
                href={`/events/${s.id}`}
                className={cx(
                  "group flex items-center gap-3 rounded-field border-2 border-night p-2 pr-14 shadow-[3px_4px_0_0_var(--color-night)] transition-[translate,box-shadow] duration-(--duration-base) ease-spring hover:-translate-y-0.5 hover:shadow-[4px_6px_0_0_var(--color-night)] active:translate-y-0 dark:border-line",
                  mine ? "bg-lime text-on-block" : "bg-surface",
                )}
              >
                <span
                  className={cx(
                    "flex size-14 shrink-0 flex-col items-center justify-center rounded-[10px] border-2 border-night leading-none",
                    mine ? "bg-night text-lime" : "bg-lime text-on-block",
                  )}
                >
                  <span className="font-display text-xl font-extrabold">{day}</span>
                  <span className="text-[0.65rem] font-bold uppercase">
                    {month} {yearTag(s.startsAt, now)}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-display text-lg leading-tight font-extrabold">
                      {s.venue?.city ?? "City TBA"}
                    </span>
                    {mine && (
                      <span className="shrink-0 rounded-chip bg-night px-2 py-0.5 text-[0.65rem] font-bold text-lime">
                        📍 Your city
                      </span>
                    )}
                  </span>
                  <span
                    className={cx("block truncate text-sm", mine ? "opacity-80" : "text-muted")}
                  >
                    {venueName(s.venue?.name) ?? VENUE_SOON}
                  </span>
                  <span className="block text-xs font-semibold">
                    <span aria-hidden>{badge.emoji} </span>
                    {badge.label}
                  </span>
                </span>
              </Link>
              <HeartButton
                show={toSavedShowInput(s)}
                className="absolute top-1/2 right-2 z-10 -translate-y-1/2"
              />
            </li>
          );
        })}
      </ol>
    </>
  );
}
