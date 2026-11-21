/**
 * One show night = one group of candidates (D-073). Unlike the collector's clustering, which
 * joins candidates up to a day apart (a festival's days), a gig groups only on the **same IST
 * date**, the same city and the same headliner: a residency on 5, 6 and 9 December is three
 * nights, and each is gated, published and verified on its own.
 */
import type { ValidatedCandidate } from "../events/extract/candidate";
import { normalizeCity } from "../events/venue";
import { normalizeArtistName } from "../shared/normalize";
import type { GateSource } from "./auto-publish";
import { isoDate } from "./extract";
import { registrableDomain } from "./registrable-domain";
import type { GigProvenance } from "./provenance";

export type ValidatedGig = ValidatedCandidate & { provenance?: GigProvenance };

export type Night = {
  /** "YYYY-MM-DD|city|headliner": stable across runs, the gate decision's key. */
  key: string;
  night: string;
  city: string;
  headliner: string;
  members: ValidatedGig[];
};

/** The night key of a candidate, or null when it has no confirmed headliner or is a range. */
export function nightKey(c: ValidatedGig): string | null {
  const headliner = c.artists[0];
  if (!headliner || c.endsAt !== null) return null;
  return `${isoDate(c.startsAt)}|${normalizeCity(c.city)}|${normalizeArtistName(headliner)}`;
}

/**
 * Groups candidates into nights. A candidate whose headliner isn't the first act elsewhere
 * still joins a night when it names that headliner among its acts on the same date and city.
 */
export function groupNights(candidates: readonly ValidatedGig[]): Night[] {
  const nights = new Map<string, Night>();
  const keyed = candidates.flatMap((c) => {
    const key = nightKey(c);
    return key ? [{ c, key }] : [];
  });
  for (const { c, key } of keyed) {
    const night = nights.get(key) ?? {
      key,
      night: isoDate(c.startsAt),
      city: c.city,
      headliner: c.artists[0]!,
      members: [],
    };
    if (!night.members.some((m) => m.source === c.source && m.externalId === c.externalId)) {
      night.members.push(c);
    }
    nights.set(key, night);
  }
  // Ranges and other-headliner candidates join every night they cover on the same city.
  for (const night of nights.values()) {
    const head = normalizeArtistName(night.headliner);
    for (const c of candidates) {
      if (night.members.includes(c) || normalizeCity(c.city) !== normalizeCity(night.city)) {
        continue;
      }
      const covers =
        c.endsAt !== null
          ? isoDate(c.startsAt) <= night.night && night.night <= isoDate(c.endsAt)
          : isoDate(c.startsAt) === night.night;
      if (covers && c.artists.some((a) => normalizeArtistName(a) === head)) night.members.push(c);
    }
  }
  return [...nights.values()];
}

/** The gate's view of one member. Candidates without provenance (news adapters) have no quotes. */
export function toGateSource(c: ValidatedGig): GateSource {
  const p = c.provenance;
  return {
    url: c.url,
    domain: p?.domain ?? registrableDomain(c.url) ?? c.url,
    officialKind: p?.officialKind ?? null,
    title: c.title,
    night: isoDate(c.startsAt),
    startTime: p?.startTime ?? null,
    dateOnly: p?.dateOnly ?? false,
    dateRange: p?.dateRange ?? c.endsAt !== null,
    city: c.city,
    artists: c.artists,
    quotes: p?.quotes ?? {},
    cancelled: c.cancelled === true,
  };
}
