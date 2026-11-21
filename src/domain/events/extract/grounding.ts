/**
 * Grounding for model-extracted facts (D-061, D-064). A model reads one page we fetched and
 * returns facts, each with a quote. A fact survives only if its quote appears verbatim in that
 * page's text and actually states the fact (the date in the quote, the name in the quote).
 * Nothing the model says counts on its own: the page is the source.
 */
import { z } from "zod";
import { foldText } from "../text";
import { findDateRanges } from "./dates";
import { findCity } from "./places";

/** The JSON contract the extractor must return (validated; anything else is ignored). */
/** D-070 output caps: an oversized reply is rejected whole, never truncated into "facts". */
export const EXTRACTION_LIMITS = { name: 200, quote: 600, artists: 60, quotes: 12 } as const;
const name = z.string().max(EXTRACTION_LIMITS.name);
export const ExtractionSchema = z.object({
  title: name.nullish(),
  startDate: z.iso.date().nullish(),
  endDate: z.iso.date().nullish(),
  city: name.nullish(),
  venue: name.nullish(),
  headliners: z.array(name).max(EXTRACTION_LIMITS.artists).nullish(),
  support: z.array(name).max(EXTRACTION_LIMITS.artists).nullish(),
  quotes: z
    .record(z.string().max(40), z.string().max(EXTRACTION_LIMITS.quote).nullish())
    .refine((q) => Object.keys(q).length <= EXTRACTION_LIMITS.quotes, "too many quotes")
    .nullish(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export type GroundedFacts = {
  title: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  city: string | null;
  venue: string | null;
  headliners: string[];
  support: string[];
  /** Fields the model gave that failed grounding, with why. */
  dropped: string[];
};

/** Compares text the way a reader would: case, whitespace, curly quotes and dashes don't matter. */
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‛′]/gu, "'")
    .replace(/[“”‟″]/gu, '"')
    .replace(/[‐‑‒–—―]/gu, "-")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

const ist = (isoDay: string) => new Date(`${isoDay}T00:00:00+05:30`);

/** Checks every field against its quote and the page text; returns what survives. */
export function groundExtraction(raw: unknown, pageText: string): GroundedFacts {
  const out: GroundedFacts = {
    title: null,
    startsAt: null,
    endsAt: null,
    city: null,
    venue: null,
    headliners: [],
    support: [],
    dropped: [],
  };
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    out.dropped.push("all: the reply was not the agreed JSON");
    return out;
  }
  const e = parsed.data;
  const page = normalize(pageText);
  const quotes = e.quotes ?? {};
  /** The quote for a field (first of the given keys) if it is verbatim in the page. */
  const quoteFor = (field: string, ...keys: string[]): string | null => {
    for (const key of [field, ...keys]) {
      const q = quotes[key];
      if (q && q.trim().length >= 3 && page.includes(normalize(q))) return q;
    }
    return null;
  };
  const drop = (field: string, why: string) => out.dropped.push(`${field}: ${why}`);

  if (e.title) {
    const q = quoteFor("title");
    if (q && normalize(q).includes(normalize(e.title))) out.title = e.title.trim();
    else drop("title", q ? "not in its quote" : "no verbatim quote");
  }

  if (e.startDate) {
    const q = quoteFor("startDate", "date", "dates");
    // The quote must state the date with its year: no year is ever inferred (D-054).
    const range = q
      ? findDateRanges(q, ist(e.startDate)).find(
          (r) => r.start.getTime() === ist(e.startDate!).getTime(),
        )
      : undefined;
    if (range) {
      out.startsAt = range.start;
      const endOk = e.endDate && range.end && range.end.getTime() === ist(e.endDate).getTime();
      out.endsAt = endOk ? range.end : null;
      if (e.endDate && !endOk) drop("endDate", "not stated with the start date");
    } else {
      drop("startDate", q ? "quote does not state this date with its year" : "no verbatim quote");
    }
  }

  if (e.city) {
    const q = quoteFor("city", "venue");
    const city = q ? findCity(q) : null;
    if (city && city === findCity(e.city)) out.city = city;
    else drop("city", q ? "quote names another or no city" : "no verbatim quote");
  }

  if (e.venue) {
    const q = quoteFor("venue", "city");
    if (q && foldText(q).includes(foldText(e.venue))) out.venue = e.venue.trim();
    else drop("venue", q ? "not in its quote" : "no verbatim quote");
  }

  const names = (field: "headliners" | "support", list: readonly string[] | null | undefined) => {
    if (!list || list.length === 0) return [];
    const q = quoteFor(field, field === "headliners" ? "lineup" : "supportActs");
    if (!q) {
      drop(field, "no verbatim quote");
      return [];
    }
    const folded = foldText(q);
    const kept = list.filter((n) => n.trim() !== "" && folded.includes(foldText(n)));
    const missing = list.filter((n) => !kept.includes(n));
    if (missing.length > 0) drop(field, `not in the quote: ${missing.join(", ")}`);
    return kept.map((n) => n.trim());
  };
  out.headliners = names("headliners", e.headliners);
  out.support = names("support", e.support);
  return out;
}
