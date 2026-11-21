/**
 * Picking songs for one lineup artist (D-038) and ordering the playlist (D-040). Pure.
 * The application gathers the candidates (already mapped to Spotify tracks); this decides.
 */
import type { SpotifyArtistId, SpotifyTrackId } from "@/domain/shared/ids";
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";
import { normalizeTrackTitle, trackVersion } from "./track-title";

export type TrackCandidate = {
  id: SpotifyTrackId;
  name: string;
  artistIds: SpotifyArtistId[];
  isrc: string | null;
  /** Real length; filling to a time budget uses it (D-065). */
  durationMs?: number;
};

/** Signals in rollover order: an unfilled slot moves to the next one (D-038). */
export const SIGNALS = ["mostListened", "trending", "newest", "search"] as const;
export type Signal = (typeof SIGNALS)[number];
export type SignalCandidates = Record<Signal, readonly TrackCandidate[]>;

export type TierQuota = { mostListened: number; trending: number; newest: number };

/**
 * D-038 per-artist mix. Mid and support get one "trending-or-newest" slot: it sits on
 * `trending` and rolls over to `newest` when the artist isn't charting.
 */
export const TIER_QUOTAS: Record<BillingTier, TierQuota> = {
  headliner: { mostListened: 5, trending: 3, newest: 2 },
  sub: { mostListened: 3, trending: 1, newest: 1 },
  mid: { mostListened: 2, trending: 1, newest: 0 },
  support: { mostListened: 1, trending: 1, newest: 0 },
};

export const tierTotal = (tier: BillingTier): number => {
  const q = TIER_QUOTAS[tier];
  return q.mostListened + q.trending + q.newest;
};

/** What dedupe needs to remember about a picked track. */
export type PickedTrack = { id: SpotifyTrackId; isrc: string | null; key: string };

/** Normalized title + primary artist: the last dedupe tier after id and ISRC. */
export const pickedTrack = (t: TrackCandidate): PickedTrack => ({
  id: t.id,
  isrc: t.isrc?.toUpperCase() ?? null,
  key: `${normalizeTrackTitle(t.name)}|${t.artistIds[0] ?? ""}`,
});

class SeenTracks {
  private readonly ids = new Set<string>();
  private readonly isrcs = new Set<string>();
  private readonly keys = new Set<string>();

  constructor(picked: readonly PickedTrack[]) {
    for (const p of picked) this.add(p);
  }

  has(p: PickedTrack): boolean {
    return (
      this.ids.has(p.id) || (p.isrc !== null && this.isrcs.has(p.isrc)) || this.keys.has(p.key)
    );
  }

  add(p: PickedTrack): void {
    this.ids.add(p.id);
    if (p.isrc !== null) this.isrcs.add(p.isrc);
    this.keys.add(p.key);
  }
}

/** Drops tracks not credited to the artist and alternate versions whose original is in the pool. */
function eligibleFilter(
  artistId: SpotifyArtistId,
  signals: SignalCandidates,
): (t: TrackCandidate) => boolean {
  const credited = (t: TrackCandidate) => t.artistIds.includes(artistId);
  const originals = new Set(
    SIGNALS.flatMap((s) => signals[s])
      .filter((t) => credited(t) && trackVersion(t.name) === null)
      .map((t) => normalizeTrackTitle(t.name)),
  );
  return (t) =>
    credited(t) && (trackVersion(t.name) === null || !originals.has(normalizeTrackTitle(t.name)));
}

/**
 * Picks up to the tier's total for one artist. Each signal fills its quota plus whatever the
 * signals before it left unfilled; search order takes the remainder; a last pass backfills from
 * any signal. Tracks already in `alreadyPicked` (earlier artists) are never repeated.
 */
export function selectArtistTracks(input: {
  tier: BillingTier;
  artistId: SpotifyArtistId;
  signals: SignalCandidates;
  alreadyPicked: readonly PickedTrack[];
}): TrackCandidate[] {
  const quota: Record<Signal, number> = { ...TIER_QUOTAS[input.tier], search: 0 };
  const total = tierTotal(input.tier);
  const eligible = eligibleFilter(input.artistId, input.signals);
  const seen = new SeenTracks(input.alreadyPicked);
  const picked: TrackCandidate[] = [];

  const take = (signal: Signal, max: number): number => {
    let taken = 0;
    for (const t of input.signals[signal]) {
      if (taken >= max || picked.length >= total) break;
      const p = pickedTrack(t);
      if (!eligible(t) || seen.has(p)) continue;
      seen.add(p);
      picked.push(t);
      taken++;
    }
    return taken;
  };

  let carry = 0;
  for (const signal of SIGNALS) {
    const want = quota[signal] + carry;
    carry = want - take(signal, want);
  }
  for (const signal of SIGNALS) take(signal, total - picked.length);
  return picked;
}

/**
 * D-065: the artist's whole ranked pool, best first. The head follows the D-038 tier mix
 * (with rollover), then every other eligible track by signal, then album tracks by recency.
 * Same filters and dedupe as `selectArtistTracks`; `fillToBudget` takes from the front.
 */
export function rankArtistPool(input: {
  tier: BillingTier;
  artistId: SpotifyArtistId;
  signals: SignalCandidates & { albums?: readonly TrackCandidate[] };
  alreadyPicked: readonly PickedTrack[];
}): TrackCandidate[] {
  const albums = input.signals.albums ?? [];
  const head = selectArtistTracks(input);
  const all: SignalCandidates = {
    ...input.signals,
    search: [...input.signals.search, ...albums],
  };
  const eligible = eligibleFilter(input.artistId, all);
  const seen = new SeenTracks([...input.alreadyPicked, ...head.map(pickedTrack)]);
  const rest: TrackCandidate[] = [];
  for (const signal of SIGNALS) {
    for (const t of all[signal]) {
      const p = pickedTrack(t);
      if (!eligible(t) || seen.has(p)) continue;
      seen.add(p);
      rest.push(t);
    }
  }
  return [...head, ...rest];
}

export type ArtistPicks = {
  tier: BillingTier;
  billingRank: number;
  trackIds: readonly SpotifyTrackId[];
};

/**
 * D-040: headliners first, then sub, mid, support. Inside a tier, artists (by billing rank)
 * take turns, one song each, so one artist's songs are never back to back.
 */
export function orderPlaylist(artists: readonly ArtistPicks[]): SpotifyTrackId[] {
  const out: SpotifyTrackId[] = [];
  for (const tier of BILLING_TIERS) {
    const inTier = artists
      .filter((a) => a.tier === tier)
      .sort((a, b) => a.billingRank - b.billingRank);
    const rounds = Math.max(0, ...inTier.map((a) => a.trackIds.length));
    for (let round = 0; round < rounds; round++) {
      for (const a of inTier) {
        const id = a.trackIds[round];
        if (id !== undefined) out.push(id);
      }
    }
  }
  return out;
}
