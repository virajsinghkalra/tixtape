"use client";

import { useEffect, useState } from "react";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { PLAYLIST_COOKING } from "./lineup-copy";
import type { ListenNow as Data } from "@/domain/events/listen-now";

/**
 * Interim fallback while the event has no shared playlist: a sibling tour playlist, else
 * compact artist-page links. Read from our own DB (no Spotify calls); gone once the real one is ready.
 */
export function ListenNow({
  eventId,
  onTour,
}: {
  eventId: string;
  /** Told when a tour sibling exists: that playlist is this event's playlist too. */
  onTour?: (has: boolean) => void;
}) {
  const [data, setData] = useState<(Data & { paused?: boolean }) | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/events/${eventId}/listen-now`)
      .then((r) => (r.ok ? (r.json() as Promise<Data & { paused?: boolean }>) : null))
      .then((body) => {
        if (!live) return;
        setData(body);
        // A tour sibling is this event's playlist; while Spotify cools down nothing can be made.
        onTour?.(Boolean(body?.sibling || body?.paused));
      })
      .catch(() => live && onTour?.(false));
    return () => {
      live = false;
    };
  }, [eventId, onTour]);

  if (!data) return null;
  if (data.sibling) {
    return (
      <SpotifyOpenLink href={data.sibling.url}>
        <span aria-hidden>▶</span> Open in Spotify
      </SpotifyOpenLink>
    );
  }
  // Nothing to play: no heading line that points at an empty space.
  if (data.artists.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {data.paused && <p className="text-lg font-semibold">{PLAYLIST_COOKING}</p>}
      {data.artists.map((a, i) => (
        <SpotifyOpenLink
          key={a.url}
          href={a.url}
          eventId={eventId}
          variant={i === 0 ? undefined : "secondary"}
          size={i === 0 ? "lg" : "md"}
        >
          <span aria-hidden>▶</span> Play {a.name}
        </SpotifyOpenLink>
      ))}
    </div>
  );
}
