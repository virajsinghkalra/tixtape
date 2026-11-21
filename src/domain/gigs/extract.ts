/**
 * Rule-based, quote-grounded gig extraction (D-073). No model: every fact is an exact span of
 * the page text we fetched ourselves, so grounding holds by construction and the extractor
 * runs anywhere (GitHub Models is blocked on the laptop, D-069).
 *
 * - `extractArtistGigs`: free text (an artist's site, an allowed outlet). A line with an
 *   explicit-year date and an Indian city (on that line or the one before or after) that
 *   names the artist (or sits on the artist's own site) becomes one candidate per night.
 * - `gigsFromJsonLd`: schema.org `Event` / `MusicEvent` JSON-LD (listings, venue and artist
 *   sites). The quotes are the JSON values themselves.
 */
import { CANCELLED } from "../events/extract/article";
import type { ArtistMention, CollectorSource, SourceTrust } from "../events/extract/candidate";
import { findCity, findVenue } from "../events/extract/places";
import { istDay } from "../events/ist-calendar";
import { foldText } from "../events/text";
import { registrableDomain } from "./registrable-domain";
import type { GigCandidate, GigProvenance, OfficialKind } from "./provenance";
import { findDateMentions, findShowTime, type DateMention } from "./show-dates";

export type ReadPage = { url: string; title: string; text: string };

export type ExtractContext = {
  now: Date;
  source: CollectorSource;
  trust: SourceTrust;
  officialKind: OfficialKind | null;
  via: GigProvenance["via"];
};

const QUOTE_MAX = 300;
const DAY_MS = 86_400_000;

export const isoDate = (d: Date): string => {
  const x = istDay(d);
  return `${x.year}-${String(x.month + 1).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`;
};

/** A verbatim slice of `line` of at most QUOTE_MAX characters around position `at`. */
function spanAround(line: string, at: number, length = 0): string {
  if (line.length <= QUOTE_MAX) return line;
  const start = Math.max(0, Math.min(at - 100, line.length - QUOTE_MAX));
  return line.slice(start, start + Math.max(QUOTE_MAX, length));
}

/** True when the folded text contains the artist's folded name as whole words. */
export function namesArtist(text: string, artist: string): boolean {
  const name = foldText(artist);
  return name !== "" && ` ${foldText(text)} `.includes(` ${name} `);
}

/** The first line of the page naming the artist, as a quote (for headliner grounding). */
function artistQuote(lines: readonly string[], artist: string): string | undefined {
  const line = lines.find((l) => namesArtist(l, artist));
  if (!line) return undefined;
  const at = line.toLowerCase().indexOf(artist.toLowerCase());
  return spanAround(line, Math.max(0, at), artist.length);
}

/** Future-or-today, at most 18 months away (D-054); the gate checks again. */
function inWindow(d: Date, now: Date): boolean {
  const horizon = new Date(now);
  horizon.setUTCMonth(horizon.getUTCMonth() + 18);
  return d.getTime() >= now.getTime() - DAY_MS && d.getTime() <= horizon.getTime();
}

function candidatesFor(
  mention: DateMention,
  base: Omit<GigCandidate, "startsAt" | "endsAt" | "externalId" | "provenance"> & {
    provenance: Omit<GigProvenance, "runNights" | "dateRange">;
  },
  url: string,
  now: Date,
): GigCandidate[] {
  if (mention.kind === "range") {
    if (!inWindow(mention.start, now)) return [];
    return [
      {
        ...base,
        externalId: `${base.provenance.via}:${url}#${isoDate(mention.start)}..${isoDate(mention.end)}`,
        startsAt: mention.start,
        endsAt: mention.end,
        provenance: { ...base.provenance, runNights: [], dateRange: true },
      },
    ];
  }
  const run = mention.nights.map(isoDate);
  return mention.nights
    .filter((n) => inWindow(n, now))
    .map((night) => ({
      ...base,
      externalId: `${base.provenance.via}:${url}#${isoDate(night)}`,
      startsAt: night,
      endsAt: null,
      provenance: {
        ...base.provenance,
        runNights: run.filter((d) => d !== isoDate(night)),
        dateRange: false,
      },
    }));
}

/** Show candidates for `artist` in a page's text, one per night, each with its quotes. */
export function extractArtistGigs(
  page: ReadPage,
  artist: string,
  ctx: ExtractContext,
): GigCandidate[] {
  const domain = registrableDomain(page.url);
  if (!domain) return [];
  const lines = page.text.split("\n");
  const ownSite = ctx.officialKind === "artist";
  const headlinerQuote = artistQuote(lines, artist);
  const out: GigCandidate[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const mentions = findDateMentions(line);
    if (mentions.length === 0) return;
    const neighbours = [lines[i - 1] ?? "", line, lines[i + 1] ?? ""];
    // An outlet's city must sit on the date's own line: a neighbouring line may be another
    // edition or another city (the D-055 failure). A tour listing on the artist's own site
    // may put it on the line above ("PCRC | Mumbai 2027" / "19 February 2027"), never below:
    // the line below is the next show's heading.
    const cityLine = (ownSite ? [line, lines[i - 1] ?? ""] : [line]).find(
      (l) => findCity(l) !== null,
    );
    if (!cityLine) return;
    const window = neighbours.join("\n");
    // Outlet pages must name the artist on the date's own line; the artist's own site needn't.
    const named = namesArtist(line, artist);
    if (!named && !ownSite) return;
    const headliner = named ? artistQuote([line], artist) : headlinerQuote;
    const time = findShowTime(line) ?? findShowTime(window);
    const venue = findVenue(window);
    const city = findCity(cityLine)!;
    for (const mention of mentions) {
      const base = {
        source: ctx.source,
        trust: ctx.trust,
        url: page.url,
        title: null,
        type: "concert" as const,
        dateExplicit: true,
        city,
        country: "IN",
        venueName: venue?.city === city ? venue.name : null,
        artists: [{ name: artist, parts: [] }] satisfies ArtistMention[],
        confidence: 0.8,
        fingerprint: page.url,
        ...(CANCELLED.test(window) ? { cancelled: true } : {}),
        provenance: {
          domain,
          officialKind: ctx.officialKind,
          artist,
          startTime: time?.hhmm ?? null,
          dateOnly: false,
          quotes: {
            date: mention.quote,
            city: spanAround(cityLine, cityLine === line ? mention.index : 0),
            ...(headliner ? { headliner } : {}),
            ...(time ? { time: time.quote } : {}),
            ...(venue?.city === city ? { venue: spanAround(window.replace(/\n/gu, " "), 0) } : {}),
          },
          via: ctx.via,
        },
      };
      for (const c of candidatesFor(mention, base, page.url, ctx.now)) {
        if (seen.has(c.externalId)) continue;
        seen.add(c.externalId);
        out.push(c);
      }
    }
  });
  return out;
}

// ── schema.org JSON-LD ─────────────────────────────────────────────────────

export type JsonLdEvent = {
  name: string;
  url: string | null;
  startDate: string;
  location: string | null;
  locality: string | null;
  performers: string[];
  cancelled: boolean;
};

const EVENT_TYPES = new Set(["Event", "MusicEvent", "Festival", "ComedyEvent", "TheaterEvent"]);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function toEvent(node: Record<string, unknown>): JsonLdEvent | null {
  const types = ([] as unknown[]).concat(node["@type"]);
  if (!types.some((t) => typeof t === "string" && EVENT_TYPES.has(t))) return null;
  const name = str(node.name);
  const startDate = str(node.startDate);
  if (!name || !startDate) return null;
  const loc = isRecord(node.location) ? node.location : null;
  const address = loc && isRecord(loc.address) ? loc.address : null;
  const performers = ([] as unknown[])
    .concat(node.performer ?? [])
    .flatMap((p) => (isRecord(p) ? (str(p.name) ?? []) : (str(p) ?? [])));
  return {
    name,
    url: str(node.url),
    startDate,
    location: loc ? str(loc.name) : null,
    locality: address ? str(address.addressLocality) : null,
    performers,
    cancelled: /EventCancelled|EventPostponed/u.test(String(node.eventStatus ?? "")),
  };
}

/** Every Event node in parsed JSON-LD blocks (top level, `@graph`, `ItemList` items). */
export function jsonLdEvents(blocks: readonly unknown[]): JsonLdEvent[] {
  const out: JsonLdEvent[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 4) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    if (!isRecord(node)) return;
    const event = toEvent(node);
    if (event) out.push(event);
    for (const key of ["@graph", "itemListElement", "item", "subEvent"]) {
      if (key in node) visit(node[key], depth + 1);
    }
  };
  blocks.forEach((b) => visit(b, 0));
  return out;
}

const ISO_START = /^(20\d{2})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/u;

/** "2026-12-05T19:30:00+05:30" → the IST night and "19:30"; null without a four-digit year. */
export function parseJsonLdStart(value: string): { night: Date; time: string | null } | null {
  const m = ISO_START.exec(value);
  if (!m) return null;
  const night = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00+05:30`);
  if (Number.isNaN(night.getTime()) || isoDate(night) !== `${m[1]}-${m[2]}-${m[3]}`) return null;
  // Midnight ("T00:00") is how many sites write "no time": treat it as date-only.
  const time = m[4] && !(m[4] === "00" && m[5] === "00") ? `${m[4]}:${m[5]}` : null;
  return { night, time };
}

/** "Live Vibes | Nikita performs …", "CROSS/OVER Ft Nikhil Chinapa", "X Live at Y" → acts. */
export function actsFromListingTitle(title: string): ArtistMention[] {
  const out: ArtistMention[] = [];
  const add = (raw: string | undefined) => {
    const name = raw
      ?.replace(/^(dj)\s+/iu, "DJ ")
      .replace(/\s+/gu, " ")
      .trim();
    if (name && name.length >= 2 && name.length <= 60 && !out.some((m) => m.name === name)) {
      out.push({ name, parts: [] });
    }
  };
  const segments = title.split("|").map((s) => s.trim());
  for (const seg of segments) {
    add(/\b(?:ft\.?|feat\.?|featuring)\s+(.+?)(?:\s+(?:at|@|live)\b.*)?$/iu.exec(seg)?.[1]);
    add(/^(.+?)\s+(?:live at|live in|performs\b|live$)/iu.exec(seg)?.[1]);
  }
  return out;
}

/** Candidates from JSON-LD events, grounded on their own values. */
export function gigsFromJsonLd(
  events: readonly JsonLdEvent[],
  page: { url: string; city: string | null; cityQuote: string | null },
  ctx: ExtractContext & { acts?: (e: JsonLdEvent) => ArtistMention[] },
): GigCandidate[] {
  const out: GigCandidate[] = [];
  for (const e of events) {
    const url = e.url ?? page.url;
    const domain = registrableDomain(url);
    const start = parseJsonLdStart(e.startDate);
    if (!domain || !start || !inWindow(start.night, ctx.now)) continue;
    const ownCity = findCity(e.location ?? "") ?? findCity(e.name);
    const city = ownCity ?? page.city;
    if (!city) continue;
    const performers = e.performers.map((name) => ({ name, parts: [] }));
    const artists = performers.length > 0 ? performers : (ctx.acts?.(e) ?? []);
    if (artists.length === 0) continue;
    const cityQuote = ownCity ? (findCity(e.location ?? "") ? e.location : e.name) : page.cityQuote;
    out.push({
      source: ctx.source,
      trust: ctx.trust,
      externalId: `${ctx.via}:${url}#${isoDate(start.night)}`,
      url,
      title: e.name,
      type: /\b(festival|fest|weekender)\b/iu.test(e.name) ? "festival" : "concert",
      startsAt: start.night,
      endsAt: null,
      dateExplicit: true,
      city,
      country: "IN",
      venueName: e.location,
      artists,
      confidence: 0.85,
      fingerprint: url,
      ...(e.cancelled ? { cancelled: true } : {}),
      provenance: {
        domain,
        officialKind: ctx.officialKind,
        artist: null,
        startTime: start.time,
        dateOnly: start.time === null,
        runNights: [],
        dateRange: false,
        quotes: {
          title: e.name,
          date: e.startDate,
          ...(start.time ? { time: e.startDate } : {}),
          ...(cityQuote ? { city: cityQuote } : {}),
          headliner: e.name,
          ...(e.location ? { venue: e.location } : {}),
        },
        via: ctx.via,
      },
    });
  }
  return out;
}

const LD_SCRIPT =
  /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/giu;

/** The parsed JSON-LD blocks of an HTML page; blocks that aren't valid JSON are skipped. */
export function jsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(LD_SCRIPT)) {
    try {
      out.push(JSON.parse(m[1]!.trim()));
    } catch {
      // A malformed block says nothing; other blocks still count.
    }
  }
  return out;
}

/** The `name` of the page's first JSON-LD ItemList ("Events & Experiences in Mumbai"). */
export function itemListName(blocks: readonly unknown[]): string | null {
  for (const b of blocks) {
    if (isRecord(b) && b["@type"] === "ItemList") return str(b.name);
  }
  return null;
}
