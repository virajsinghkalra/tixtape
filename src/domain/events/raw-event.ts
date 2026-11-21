/**
 * The shape every event source produces (LLD §5.2). Adapters validate third-party data
 * into this; the ingest pipeline trusts it afterwards.
 *
 * Optional fields: `undefined` means "this source doesn't know", `null` means "known to be empty".
 * Field merging relies on that difference (see `mergeEventFields`).
 */
import { z } from "zod";
import { httpUrl } from "./http-url";
import { buildLineup } from "./lineup";
import { BILLING_TIERS, EVENT_SOURCES, EVENT_STATUSES, EVENT_TYPES } from "@/domain/shared/lineup";

/** At most this many artists after credits are split ("A b2b B" counts as two). Lead decision. */
export const MAX_LINEUP_SIZE = 300;
/** Bounds the work done before splitting; the artist limit above is the real rule. */
export const MAX_LINEUP_CREDITS = 1000;

/** True when the credits split into at most `MAX_LINEUP_SIZE` distinct artists. */
export function fitsArtistLimit(entries: readonly RawLineupEntry[]): boolean {
  return buildLineup(entries).length <= MAX_LINEUP_SIZE;
}
export const ARTIST_LIMIT_MESSAGE = `A lineup can have at most ${MAX_LINEUP_SIZE} artists.`;

/** Strict: admin request bodies embed it (D-018). */
export const RawVenueSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().max(100).nullish(),
  /** ISO 3166-1 alpha-2. */
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/u, "Use a two-letter country code, e.g. IN.")
    .transform((c) => c.toUpperCase()),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
});
export type RawVenue = z.infer<typeof RawVenueSchema>;

export const RawLineupEntrySchema = z.object({
  /** Display name as billed; may name several artists ("A b2b B"), split later. */
  name: z.string().trim().min(1).max(200),
  tier: z.enum(BILLING_TIERS),
  /** 1 = top of the bill. */
  billingRank: z.number().int().positive(),
  day: z.number().int().min(1).max(31).nullish(),
  stage: z.string().trim().min(1).max(100).nullish(),
});
export type RawLineupEntry = z.infer<typeof RawLineupEntrySchema>;

export const RawEventSchema = z.object({
  source: z.enum(EVENT_SOURCES),
  /** The source's own ID. Null only for admin entry, where the event ID is used. */
  externalId: z.string().min(1).max(200).nullable(),
  url: httpUrl().nullish(),
  title: z.string().trim().min(1).max(300),
  type: z.enum(EVENT_TYPES),
  startsAt: z.date(),
  /** True when the source gave a date but no time: `startsAt` is 00:00 local (D-034, "time TBA"). */
  startsAtDateOnly: z.boolean().optional(),
  endsAt: z.date().nullish(),
  status: z.enum(EVENT_STATUSES).optional(),
  genre: z.string().trim().max(100).nullish(),
  imageUrl: httpUrl().nullish(),
  venue: RawVenueSchema,
  lineup: z
    .array(RawLineupEntrySchema)
    .max(MAX_LINEUP_CREDITS)
    .refine(fitsArtistLimit, ARTIST_LIMIT_MESSAGE),
  /** The source payload, stored in event_sources.raw for audit. */
  raw: z.unknown(),
});
export type RawEvent = z.infer<typeof RawEventSchema>;
