/**
 * Client side of "Sounds like this" (UX #7, D-088): `GET /api/search/similar?artist=`.
 * Validated, and every failure (429, offline, bad JSON) is just "no row".
 */
import { z } from "zod";
import type { ShowRowItem } from "../ShowRow";

const Body = z.object({
  shows: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        startsAt: z.string(),
        city: z.string().nullable().default(null),
        artist: z.string(),
      }),
    )
    .default([]),
});

export function similarFromBody(raw: unknown): ShowRowItem[] {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.shows.map((s) => ({
    id: s.id,
    title: s.title,
    startsAt: s.startsAt,
    city: s.city,
    artist: s.artist,
  }));
}

export async function fetchSimilar(
  artist: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<ShowRowItem[]> {
  try {
    const res = await fetchFn(`/api/search/similar?artist=${encodeURIComponent(artist.trim())}`, {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    return similarFromBody(await res.json());
  } catch {
    return [];
  }
}
