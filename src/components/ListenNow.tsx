"use client";

import { useEffect, useState } from "react";
import { ListenHere } from "./ListenHere";
import { SpotifyOpenLink } from "./SpotifyOpenLink";
import { cookingLine, type Vibe } from "./vibe-copy";
import type { ListenNow as Data } from "@/domain/events/listen-now";

/**
 * Interim fallback while the event has no shared playlist: a sibling tour playlist, else
 * compact artist-page links. Read from our own DB (no Spotify calls); gone once the real one is ready.
 */
export function ListenNow({
  eventId,
  onTour,
  vibe = "default",
}: {
  eventId: string;
  /** The music's vibe: the cooking line matches it (vibe-copy.ts). */
  vibe?: Vibe;
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
      <div className="flex flex-col gap-2.5">
        <SpotifyOpenLink href={data.sibling.url}>
          <span aria-hidden>▶</span> Open in Spotify
        </SpotifyOpenLink>
        <ListenHere url={data.sibling.url} eventId={eventId} title="Tour playlist" variant="wide" />
      </div>
    );
  }
  // Nothing to play: no heading line that points at an empty space.
  if (data.artists.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {data.paused && <p className="text-lg font-semibold">{cookingLine(vibe, eventId)}</p>}
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
