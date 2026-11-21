/**
 * Ports for gig coverage (D-073 artist-first discovery, D-074 auto-publish gate).
 * Implemented in src/infrastructure/gigs/. Small on purpose: one reason to change each.
 */
import type { GateCheck, GateSource, GateVerdict } from "@/domain/gigs/auto-publish";
import type { DemandCount, DemandKind } from "@/domain/gigs/demand";
import type { ValidatedGig } from "@/domain/gigs/nights";
import type { EventId } from "@/domain/shared/ids";
import type { MatchStatus } from "@/domain/shared/lineup";

/** Last.fm `geo.getTopArtists` for India, most listened first. */
export interface TrendingArtists {
  topInIndia(limit: number): Promise<Array<{ name: string; listeners: number }>>;
}

/** Artists already in our lineups with a confident Spotify match. */
export interface CatalogueArtists {
  matched(limit: number): Promise<Array<{ name: string; spotifyId: string }>>;
}

/** Searches that found nothing recently (search_log, the D-050 watch list), most frequent first. */
export interface SearchedTerms {
  recent(since: Date, limit: number): Promise<Array<{ term: string; count: number }>>;
}

/** The artist's own website(s) (Wikidata P856 via the Spotify ID), as http(s) URLs. */
export interface OfficialSites {
  sitesOf(spotifyId: string): Promise<string[]>;
}

export type ReadResult =
  | {
      status: "ok";
      url: string;
      title: string;
      text: string;
      /** Parsed JSON-LD blocks. */
      jsonLd: unknown[];
      /** Same-host links whose path or text looks like a tour/live/events page. */
      tourLinks: string[];
      /** D-082: the page's og:image (absolute https URL), when it has one. */
      image?: string | null;
    }
  /** HTTP 404/410: the page is gone (re-verification holds the event). */
  | { status: "gone"; url: string };

/**
 * A polite read of one allowed page (robots.txt, 1 req/s/host, SSRF guard, caps; D-070).
 * Transient failures (timeouts, robots refusal, 5xx) throw `UpstreamError`.
 */
export interface PageReader {
  read(url: string): Promise<ReadResult>;
}

export type GigLead = {
  artist: string;
  url: string;
  domain: string;
  /** The search result's title only: never page text from a site we may not read. */
  title: string;
  reason: "denied_domain" | "unknown_domain";
};

export interface GigLeadStore {
  /** Upsert on URL; refreshes `lastSeenAt`. */
  upsert(lead: GigLead, seenAt: Date): Promise<void>;
}

/** Event candidates (`event_candidates`) with their gig provenance, when they have one. */
export interface GigCandidateReader {
  listUpcoming(from: Date, seenSince: Date): Promise<ValidatedGig[]>;
}

export type ArtistMatch = { spotifyId: string | null; matchStatus: MatchStatus };

/** Our artist matching's verdict for a name (the `artists` table, by alias). */
export interface ArtistMatches {
  statusOf(name: string): Promise<ArtistMatch | null>;
}

export type GateSourceRef = Pick<GateSource, "url" | "domain" | "officialKind"> & {
  source: string;
};

export type GateRecord = {
  nightKey: string;
  title: string;
  night: string;
  city: string;
  headliner: string;
  decision: GateVerdict;
  reasons: string[];
  checks: GateCheck[];
  sources: GateSourceRef[];
  confidence: number;
  eventId: EventId | null;
  decidedAt: Date;
};

/** `gate_decisions`: the latest verdict per night (upsert on the night key). */
export interface GateDecisionStore {
  save(record: GateRecord): Promise<void>;
  get(nightKey: string): Promise<GateRecord | null>;
}

export type AuditAction = "published" | "updated" | "held" | "reverified";

export type AuditEntry = {
  eventId: EventId | null;
  nightKey: string;
  action: AuditAction;
  actor: "auto-gate";
  reasons: string[];
  /** The gate's view of each source at the time (official URL, night, time, city, acts). */
  sources: GateSource[];
  changes: Record<string, { from: unknown; to: unknown }> | null;
  at: Date;
};

export type AutoPublished = {
  eventId: EventId;
  nightKey: string;
  sources: GateSource[];
  /** Last `published`, `updated` or `reverified` entry. */
  lastCheckedAt: Date;
};

/** `publish_audit`: append-only. */
export interface PublishAuditLog {
  append(entry: AuditEntry): Promise<void>;
  /**
   * Events whose latest entry is `published`, `updated` or `reverified` (still auto-published)
   * and was written before `checkedBefore`.
   */
  dueForReverification(checkedBefore: Date): Promise<AutoPublished[]>;
}

/** The publish switch (D-074): env kill switch plus the Platform-owned pause setting. */
export interface PublishSwitch {
  /** Null when publishing may run now; otherwise why not. */
  blockedReason(now: Date): Promise<string | null>;
}

// ── D-081: demand by city ────────────────────────────────────────────────

/** Privacy-safe visitor demand: one counter per (IST day, city, kind). */
export interface CityDemandStore {
  /** Adds one to the counter for the city on `at`'s IST day. */
  record(city: string, kind: DemandKind, at: Date): Promise<void>;
  /** Every counter on or after `sinceDay` ("YYYY-MM-DD", IST). */
  since(sinceDay: string): Promise<DemandCount[]>;
}

/** Upcoming published shows per venue city (for "few shows here"). */
export interface CityShowCounts {
  upcomingPublished(now: Date): Promise<Array<{ city: string; count: number }>>;
}

/** Which artists have played or will play in which cities (our lineups). */
export interface ArtistCities {
  list(since: Date): Promise<Array<{ name: string; city: string }>>;
}
