/**
 * What the automatic collector (P1.11) extracts before corroboration (D-024, D-033).
 * A candidate is never shown to users on its own; only corroborated clusters are published.
 */
import type { EventType } from "@/domain/shared/lineup";

/** Collector sources, one per adapter in src/infrastructure/sources/. */
export const COLLECTOR_SOURCES = [
  "rollingstone",
  "pollstar",
  "wikipedia",
  "sunburn",
  "teaminnovation",
  /** Any other allow-listed page found by the doubt resolver (D-064), e.g. DJ Mag. */
  "web",
  /** D-073: HighApe city listings (schema.org Event JSON-LD; primary ticketing). */
  "highape",
  /** D-073: the artist's own website (Wikidata P856), read by artist-first discovery. */
  "artist_site",
  /** D-073: an allow-listed outlet page found by artist-first discovery. */
  "gig_web",
] as const;
export type CollectorSource = (typeof COLLECTOR_SOURCES)[number];

/**
 * Sources the generic collector (`ingest.ts`) doesn't run: search-driven ones (doubt resolver,
 * artist-first discovery) and HighApe, whose club nights are judged night by night by the gig
 * gate (D-073): the collector's ±1-day, title-overlap clustering would merge different club
 * nights ("… Night ft. DJ X") into one event.
 */
export const NOT_COLLECTOR_ADAPTERS = ["web", "artist_site", "gig_web", "highape"] as const;
export type AdapterSource = Exclude<CollectorSource, (typeof NOT_COLLECTOR_ADAPTERS)[number]>;
export const isAdapterSource = (s: string): s is AdapterSource =>
  (COLLECTOR_SOURCES as readonly string[]).includes(s) &&
  !(NOT_COLLECTOR_ADAPTERS as readonly string[]).includes(s);

/**
 * `official`: the organiser or the festival itself.
 * `trusted`: a whitelisted news outlet (D-033).
 * `structured`: an API with structured event data (Ticketmaster), used by live lookup (D-050).
 */
export type SourceTrust = "official" | "trusted" | "structured";

export const SOURCE_TRUST: Readonly<Record<CollectorSource, SourceTrust>> = {
  rollingstone: "trusted",
  pollstar: "trusted",
  /** D-070: openly editable, so trusted rather than official. */
  wikipedia: "trusted",
  sunburn: "official",
  teaminnovation: "official",
  web: "trusted",
  /** D-073: self-serve listings; the gate (D-074) still treats it as a primary ticketing page. */
  highape: "trusted",
  artist_site: "official",
  gig_web: "trusted",
};

/**
 * A name pulled from text that may be an artist. When it could be one act ("Above & Beyond")
 * or several ("Kayan & Gini"), or carries a describer ("Grammy-winning Arijit Singh"), `parts`
 * holds the fallbacks: the validator keeps `name` if Spotify confirms it, else tries `parts`.
 */
export type ArtistMention = {
  name: string;
  parts: readonly ArtistMention[];
  /** "support": an opening act (a tour table's "Opening acts" column), never a headliner. */
  role?: "support";
};

export type EventCandidate = {
  source: CollectorSource;
  trust: SourceTrust;
  /** The source's own stable ID for the item (RSS guid, post ID, page ID + year, card slug). */
  externalId: string;
  /** Where the facts came from; always kept (attribution, D-033). */
  url: string;
  /** Null when the text names no event; the collector then titles it after the headliner. */
  title: string | null;
  type: EventType;
  /** 00:00 IST on the first day; times are never known from these sources. */
  startsAt: Date;
  endsAt: Date | null;
  /** True when the year was stated by the source, not inferred (single-source publishing needs it). */
  dateExplicit: boolean;
  city: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  venueName: string | null;
  /** In billing order as far as the text tells. */
  artists: readonly ArtistMention[];
  /** 0–1: how sure the extractor is that this is a real, dated event. */
  confidence: number;
  /**
   * Where the facts originally come from (D-056 independence): copies of one press release
   * share a fingerprint and count as one source. Defaults to the URL.
   */
  fingerprint?: string;
  /** The source says the show is cancelled or postponed. */
  cancelled?: boolean;
};

/** A candidate after Spotify validation: only confirmed artist display names remain. */
export type ValidatedCandidate = Omit<EventCandidate, "artists" | "title"> & {
  title: string;
  /** Confirmed main acts, headliner first. */
  artists: readonly string[];
  /** Confirmed opening/support acts (stored with the `support` tier). */
  supportActs: readonly string[];
};
