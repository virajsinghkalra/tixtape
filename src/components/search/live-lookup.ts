/**
 * Live lookup (D-050, D-057): when a typed search finds nothing, ask whether the artist plays
 * India after all. It never blocks typing:
 *   POST /api/lookup {q} → a final answer, or {status:"searching", lookupId, artists?} in < 300ms;
 *   then GET /api/lookup/:lookupId every 700ms for up to ~8s, until a final answer or an abort
 *   (the next keystroke).
 * Every failure (404, 429, timeouts, bad JSON) is silent: the normal empty state stays.
 */
import { z } from "zod";
import type { EventResult } from "./types";

export type LookupArtist = { name: string; spotifyId?: string; imageUrl?: string };

export type LookupView =
  | { kind: "idle" }
  /** `artist`: recognised early (D-057), shown while the dates are still being checked. */
  | { kind: "looking"; query: string; artist: LookupArtist | null }
  | { kind: "found"; query: string; results: EventResult[] }
  /** `candidates`: a partial name matched several artists ("olivia"): ask which one. */
  | { kind: "not_found"; query: string; artist: LookupArtist | null; candidates: LookupArtist[] };

const lookupArtist = z.object({
  name: z.string(),
  spotifyId: z.string().optional(),
  imageUrl: z.string().url().optional(),
});
const result = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  startsAt: z.string(),
  startsAtDateOnly: z.boolean().default(false),
  city: z.string().nullable().default(null),
  venueName: z.string().nullable().default(null),
});
const body = z.discriminatedUnion("status", [
  z.object({ status: z.literal("found"), results: z.array(result).min(1) }),
  z.object({
    status: z.literal("not_found"),
    artist: lookupArtist.optional(),
    ambiguous: z.boolean().optional(),
    artists: z.array(lookupArtist).optional(),
  }),
  z.object({
    status: z.literal("searching"),
    lookupId: z.string().optional(),
    artists: z.array(lookupArtist).optional(),
  }),
]);

/** Still working: poll `lookupId` if given, else ask again. */
export type Pending = { pending: true; lookupId: string | null; artist: LookupArtist | null };

/**
 * Only plausible artist or event names: Latin letters, 3–40 characters, at least one vowel.
 * Keeps keyboard mashing, SQL-ish strings and emoji from triggering a Spotify lookup.
 */
export function worthLookingUp(query: string): boolean {
  const q = query.trim();
  return /^[a-z][a-z .'&-]{2,39}$/i.test(q) && /[aeiouy]/i.test(q);
}

/** Maps one response: a final view, `Pending`, or null to fail silently. */
export function viewFromLookup(
  query: string,
  status: number,
  raw: unknown,
): LookupView | Pending | null {
  if (status !== 200 && status !== 202) return null;
  const parsed = body.safeParse(raw);
  if (!parsed.success) return null;
  const d = parsed.data;
  if (d.status === "searching") {
    return { pending: true, lookupId: d.lookupId ?? null, artist: d.artists?.[0] ?? null };
  }
  if (d.status === "not_found") {
    const candidates = d.ambiguous ? (d.artists ?? []).slice(0, 3) : [];
    return { kind: "not_found", query, artist: d.artist ?? null, candidates };
  }
  return {
    kind: "found",
    query,
    results: d.results.map((r) => ({ ...r, matchReason: "title" as const, matchedText: "" })),
  };
}

export const POLL_MS = 700;
export const MAX_WAIT_MS = 8000;
const REQUEST_TIMEOUT_MS = 5000;

type Options = {
  fetchFn?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called with "looking" updates (e.g. once the artist is recognised). */
  onUpdate?: (view: LookupView) => void;
};

/** Starts a lookup and follows it to a final answer. Resolves null on any failure or timeout. */
export async function liveLookup(
  query: string,
  signal: AbortSignal,
  opts: Options = {},
): Promise<LookupView | null> {
  const fetchFn = opts.fetchFn ?? fetch;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const deadline = now() + MAX_WAIT_MS;
  const ask = async (lookupId: string | null) => {
    const res = lookupId
      ? await fetchFn(`/api/lookup/${encodeURIComponent(lookupId)}`, {
          signal: withTimeout(signal),
        })
      : await fetchFn("/api/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: query }),
          signal: withTimeout(signal),
        });
    return viewFromLookup(query, res.status, await res.json().catch(() => null));
  };

  try {
    let lookupId: string | null = null;
    let artist: LookupArtist | null = null;
    for (;;) {
      if (signal.aborted) return null;
      const answer = await ask(lookupId);
      if (answer === null || !("pending" in answer)) return answer;
      lookupId = answer.lookupId ?? lookupId;
      if (answer.artist && answer.artist.name !== artist?.name) {
        artist = answer.artist;
        opts.onUpdate?.({ kind: "looking", query, artist });
      }
      if (now() + POLL_MS > deadline) return null;
      await wait(POLL_MS);
    }
  } catch {
    return null;
  }
}

function withTimeout(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
}
