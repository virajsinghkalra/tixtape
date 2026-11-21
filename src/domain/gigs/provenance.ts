/**
 * Provenance carried by every gig candidate (D-073, D-074): which page said what, in which
 * exact words. Stored inside the `event_candidates.payload` JSON next to the candidate's facts,
 * and validated with this schema whenever it's read back.
 */
import { z } from "zod";
import type { EventCandidate } from "../events/extract/candidate";

/** The fields the auto-publish gate needs grounded on an official page. */
export const GROUNDED_FIELDS = ["title", "date", "time", "city", "headliner", "venue"] as const;
export type GroundedField = (typeof GROUNDED_FIELDS)[number];

/** What kind of official page this is (D-074), or null for a news/trusted page. */
export const OFFICIAL_KINDS = ["artist", "organiser", "venue", "ticketing"] as const;
export type OfficialKind = (typeof OFFICIAL_KINDS)[number];

const quote = z.string().min(1).max(600);

export const GigProvenanceSchema = z.strictObject({
  /** Registrable domain of the page (eTLD+1): the unit of source independence. */
  domain: z.string().min(1).max(200),
  officialKind: z.enum(OFFICIAL_KINDS).nullable(),
  /** The artist this page was read for (artist-first discovery), or null for a listing. */
  artist: z.string().min(1).max(200).nullable(),
  /** Start time in IST as "HH:MM", when the page states one. */
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
    .nullable(),
  /** The page gives a date but explicitly no time ("time TBA"), or structured date-only data. */
  dateOnly: z.boolean(),
  /** One of a listed run of nights ("5th, 6th and 9th December 2026"): the other nights. */
  runNights: z.array(z.iso.date()).max(31),
  /** True when the page gives a range ("5 Dec – 9 Dec 2026") rather than listed nights. */
  dateRange: z.boolean(),
  /** Exact text spans from the page text we fetched, per field. */
  quotes: z.partialRecord(z.enum(GROUNDED_FIELDS), quote),
  /** How the page was found. */
  via: z.enum(["listing", "artist_site", "search", "press"]),
  /** D-089: a news article on a D-087 outlet: who published it, when, and from which wire. */
  press: z
    .strictObject({
      publisher: z.string().min(1).max(200),
      /** The article's own publication time (JSON-LD or meta), or null when it doesn't say. */
      publishedAt: z.iso.datetime({ offset: true }).nullable(),
      wire: z.string().max(20).nullable(),
      /** Opening-text fingerprint (syndicated copies share it). */
      fingerprint: z.string().min(1).max(100),
    })
    .optional(),
});
export type GigProvenance = z.infer<typeof GigProvenanceSchema>;

/** A collector candidate with gig provenance attached. */
export type GigCandidate = EventCandidate & { provenance: GigProvenance };
