/**
 * Edition facts from Wikipedia wikitext (P1.11, D-054, D-055). Strict by design:
 * - Festival articles contribute only a section explicitly for the current or next year
 *   ("=== 2026 ==="), with dates inside that year. History sections and past editions are
 *   ignored; a page without a current-edition section contributes nothing (not even a venue),
 *   and a future edition is never synthesised.
 * - Tour articles contribute only tour-date table rows whose year is explicit (in the cell,
 *   the column header "Date (2025)", the table caption, or the section heading). The headliner
 *   is the article's subject (infobox `artist`); the "Opening acts" column is support.
 * - Years are never guessed, and past dates are dropped.
 * CC BY-SA: callers keep the page URL.
 */
import { istDay, istMidnight } from "../ist-calendar";
import { foldText } from "../text";
import { knownCity } from "../venue";
import { splitArtistCredit } from "@/domain/shared/normalize";
import { FESTIVAL_NAMES, sentences } from "./article";
import type { ArtistMention, EventCandidate } from "./candidate";
import { findDateRanges, parseDateRange, type DateRange } from "./dates";
import { findVenue } from "./places";

export type WikiPage = {
  pageId: number;
  /** The page title ("NH7 Weekender"), used for the attribution URL. */
  title: string;
  wikitext: string;
};

export type WikiFestival = {
  /** The series name used in titles: "NH7 Weekender" → "NH7 Weekender 2027". */
  eventName: string;
  /** "tour" reads tour-date tables; otherwise only current-edition sections. Detected from the infobox when omitted. */
  kind?: "festival" | "tour";
};

type Section = { level: number; heading: string; body: string };
type WikiCandidate = Omit<EventCandidate, "source" | "trust" | "url">;

function stripRefsAndTemplates(wikitext: string): string {
  let text = wikitext
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<ref\b[^>]*\/>/giu, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/giu, "");
  for (let i = 0; i < 20; i++) {
    const next = text.replace(/\{\{[^{}]*\}\}/gu, "");
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Removes comments, refs, templates (innermost first, so nesting works), bold/italics and tags. */
export function stripWikiMarkup(wikitext: string): string {
  return stripRefsAndTemplates(wikitext)
    .replace(/'{2,3}/gu, "")
    .replace(/<[^>]+>/gu, " ");
}

/** "[[Chet Faker|Nick Murphy]]" → "Nick Murphy"; "[[Opeth]]" → "Opeth". */
export function linkLabels(text: string): string[] {
  return [...text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu)].map((m) =>
    (m[2] ?? m[1] ?? "").trim(),
  );
}

function unlink(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gu, (_, target: string, label?: string) =>
    (label ?? target).trim(),
  );
}

/** An infobox field's display text ("| artist = [[Ed Sheeran]]" → "Ed Sheeran"), or null. */
export function infoboxField(wikitext: string, field: string): string | null {
  const m = new RegExp(`^\\s*\\|\\s*${field}\\s*=\\s*(.+)$`, "mu").exec(wikitext);
  if (!m?.[1]) return null;
  const text = linkLabels(m[1])[0] ?? unlink(stripWikiMarkup(m[1])).trim();
  return text === "" ? null : text;
}

const isTourPage = (wikitext: string) => /\{\{\s*Infobox concert/iu.test(wikitext);

function splitSections(wikitext: string): Section[] {
  const out: Section[] = [{ level: 1, heading: "", body: "" }];
  for (const line of wikitext.split("\n")) {
    const h = /^(={2,6})\s*(.+?)\s*\1\s*$/u.exec(line);
    if (h?.[1] && h[2]) out.push({ level: h[1].length, heading: h[2], body: "" });
    else out[out.length - 1]!.body += `${line}\n`;
  }
  return out;
}

/** A section's body plus the bodies of its subsections. */
function withSubsections(sections: Section[], index: number): Section[] {
  const level = sections[index]!.level;
  const out = [sections[index]!];
  for (let i = index + 1; i < sections.length && sections[i]!.level > level; i++) {
    out.push(sections[i]!);
  }
  return out;
}

const LINEUP_HEADING = /line-?up/iu;
const LINEUP_SENTENCE = /\b(headlin\w*|line-?up|perform\w*|featur\w*|includ\w*|such as)\b/iu;

function toMention(name: string, role?: "support"): ArtistMention {
  const split = splitArtistCredit(name);
  const parts = split.length > 1 ? split.map((n) => toMention(n, role)) : [];
  return role ? { name, parts, role } : { name, parts };
}

/** Table cells in lineup subsections, then links in lineup sentences, all within one edition. */
function artistsFrom(parts: Section[], prose: string): ArtistMention[] {
  const names: string[] = [];
  for (const s of parts) {
    if (!LINEUP_HEADING.test(s.heading) || /comedy/iu.test(s.heading)) continue;
    for (const line of s.body.split("\n")) {
      if (!line.startsWith("|") || /^\|[-}+]/u.test(line)) continue;
      for (const cell of line.slice(1).split("||")) names.push(unlink(cell).trim());
    }
  }
  for (const sentence of sentences(prose)) {
    if (LINEUP_SENTENCE.test(sentence)) names.push(...linkLabels(sentence));
  }
  const seen = new Set<string>();
  const out: ArtistMention[] = [];
  for (const name of names) {
    const key = foldText(name);
    if (key === "" || seen.has(key) || name.length > 80 || /[{}=]/u.test(name)) continue;
    if (knownCity(key) || FESTIVAL_NAMES.some((f) => foldText(f) === key)) continue;
    seen.add(key);
    out.push(toMention(name));
  }
  return out;
}

/** The last Indian city named in the 120 characters before the date (never the next clause's). */
function cityNear(text: string, range: DateRange): string | null {
  const before = text.slice(Math.max(0, range.index - 120), range.index);
  const words = foldText(before).split(" ").filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    for (let n = 3; n >= 1; n--) {
      if (i - n + 1 < 0) continue;
      const city = knownCity(words.slice(i - n + 1, i + 1).join(" "));
      if (city) return city;
    }
  }
  return null;
}

const isoDay = (d: Date) => {
  const day = istDay(d);
  return `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
};

/** Only a section headed exactly by the current or next year ("=== 2026 ==="). */
function festivalEditions(page: WikiPage, festival: WikiFestival, now: Date): WikiCandidate[] {
  const sections = splitSections(stripWikiMarkup(page.wikitext));
  const thisYear = istDay(now).year;
  const earliest = now.getTime() - 86_400_000;
  const out: WikiCandidate[] = [];
  sections.forEach((section, i) => {
    const year = Number(/^(20\d\d)$/u.exec(section.heading.trim())?.[1] ?? NaN);
    // "2013 (Goa)", "2019 edition" and history sections never match.
    if (year !== thisYear && year !== thisYear + 1) return;
    const parts = withSubsections(sections, i);
    const prose = parts
      .filter((p) => !LINEUP_HEADING.test(p.heading))
      .map((p) => p.body)
      .join("\n");
    const text = unlink(prose);
    // The heading states the year; dates are read in it and must stay in it.
    for (const range of findDateRanges(text, istMidnight(year, 0, 1), { inferYear: true })) {
      if (istDay(range.start).year !== year) continue;
      if ((range.end ?? range.start).getTime() < earliest) continue;
      const city = cityNear(text, range);
      if (!city) continue;
      const venue = findVenue(text.slice(Math.max(0, range.index - 200), range.index + 200));
      out.push({
        externalId: `${page.pageId}:${year}:${foldText(city)}`,
        title: `${festival.eventName} ${year}`,
        type: "festival",
        startsAt: range.start,
        endsAt: range.end,
        dateExplicit: true,
        city,
        country: "IN",
        venueName: venue && venue.city === city ? venue.name : null,
        artists: artistsFrom(parts, prose),
        confidence: 0.7,
        fingerprint: `wikipedia:${page.pageId}`,
      });
    }
  });
  return out;
}

type Cell = { text: string; rowspan: number; colspan: number };

function parseCell(raw: string): Cell {
  const attrs =
    /^\s*((?:[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s|]+)\s*)+)(?:\|(?!\|)([\s\S]*))?$/iu.exec(raw);
  const attrText = attrs?.[1] ?? "";
  const content = attrs ? (attrs[2] ?? "") : raw;
  const num = (name: string) =>
    Number(new RegExp(`${name}\\s*=\\s*"?(\\d+)`, "iu").exec(attrText)?.[1] ?? 1);
  return { text: content.trim(), rowspan: num("rowspan"), colspan: num("colspan") };
}

/** A wikitable as rows of cell texts, with rowspan/colspan expanded into a grid. */
function tableRows(table: string): { header: string[]; rows: string[][]; caption: string } {
  const caption = /^\|\+(.*)$/mu.exec(table)?.[1] ?? "";
  const rawRows = table
    .split(/\n\|-[^\n]*/u)
    .map((r) =>
      r
        .split("\n")
        .filter((l) => /^[|!]/u.test(l) && !/^(\{\||\|\}|\|\+)/u.test(l))
        .flatMap((l) => l.slice(1).split(/\|\||!!/u))
        .map(parseCell),
    )
    .filter((cells) => cells.length > 0);
  const headerIndex = rawRows.findIndex((cells) =>
    cells.some((c) => /^(city|venue)$/iu.test(c.text)),
  );
  if (headerIndex < 0) return { header: [], rows: [], caption };
  const header = rawRows[headerIndex]!.map((c) => c.text);
  const carry: Array<{ left: number; text: string } | undefined> = [];
  const rows: string[][] = [];
  for (const cells of rawRows.slice(headerIndex + 1)) {
    const out: string[] = [];
    let next = 0;
    for (let col = 0; col < header.length;) {
      const held = carry[col];
      if (held && held.left > 0) {
        out[col] = held.text;
        held.left--;
        col++;
        continue;
      }
      const cell = cells[next++];
      if (!cell) break;
      for (let k = 0; k < cell.colspan && col + k < header.length; k++) {
        out[col + k] = cell.text;
        carry[col + k] = cell.rowspan > 1 ? { left: cell.rowspan - 1, text: cell.text } : undefined;
      }
      col += cell.colspan;
    }
    rows.push(out);
  }
  return { header, rows, caption };
}

const column = (header: readonly string[], pattern: RegExp) =>
  header.findIndex((h) => pattern.test(h));

/** One candidate per Indian show with an explicit year. Titles read "Ed Sheeran – +−=÷× Tour". */
function tourEditions(page: WikiPage, festival: WikiFestival, now: Date): WikiCandidate[] {
  const headliner = infoboxField(page.wikitext, "artist");
  const tourName = infoboxField(page.wikitext, "concert_tour_name") ?? festival.eventName;
  const title = headliner ? `${headliner} – ${tourName}` : tourName;
  const earliest = now.getTime() - 86_400_000;
  const cleaned = stripRefsAndTemplates(page.wikitext).replace(/<br\s*\/?>/giu, "; ");
  const out: WikiCandidate[] = [];
  let headingYear: number | null = null;
  for (const piece of cleaned.split(/(\{\|[\s\S]*?\n\|\})/u)) {
    if (!piece.startsWith("{|")) {
      const years = [...piece.matchAll(/^=+[^=\n]*\b(20\d\d)\b[^=\n]*=+\s*$/gmu)];
      if (years.length > 0) headingYear = Number(years[years.length - 1]![1]);
      continue;
    }
    const { header, rows, caption } = tableRows(piece);
    const dateCol = column(header, /date/iu);
    const cityCol = column(header, /^city$/iu);
    if (dateCol < 0 || cityCol < 0) continue;
    const countryCol = column(header, /country/iu);
    const venueCol = column(header, /venue/iu);
    const openerCol = column(header, /opening|support/iu);
    const tableYear =
      Number(/\((20\d\d)\)/u.exec(header[dateCol] ?? "")?.[1] ?? NaN) ||
      Number(/\b(20\d\d)\b/u.exec(caption)?.[1] ?? NaN) ||
      headingYear;
    for (const row of rows) {
      const dateText = unlink(row[dateCol] ?? "");
      const hasYear = /\b20\d\d\b/u.test(dateText);
      if (!hasYear && !tableYear) continue; // D-054: no explicit year, no row.
      const range = parseDateRange(hasYear ? dateText : `${dateText} ${tableYear}`, now);
      if (!range || (range.end ?? range.start).getTime() < earliest) continue;
      const country = countryCol >= 0 ? unlink(row[countryCol] ?? "") : "";
      if (country !== "" && !/\bindia\b/iu.test(country)) continue;
      const city = knownCity(foldText(unlink(row[cityCol] ?? "")));
      if (!city) continue;
      const venue = venueCol >= 0 ? unlink(row[venueCol] ?? "").trim() : "";
      const openers = (openerCol >= 0 ? unlink(row[openerCol] ?? "") : "")
        .split(/[;,]/u)
        .map((n) => n.trim())
        .filter((n) => n !== "" && !/^(n\/a|—|-|tba)$/iu.test(n));
      out.push({
        externalId: `${page.pageId}:${isoDay(range.start)}:${foldText(city)}`,
        title,
        type: "concert",
        startsAt: range.start,
        endsAt: range.end,
        dateExplicit: true,
        city,
        country: "IN",
        venueName: venue === "" ? null : venue,
        artists: [
          ...(headliner ? [toMention(headliner)] : []),
          ...openers.map((n) => toMention(n, "support")),
        ],
        confidence: 0.7,
        fingerprint: `wikipedia:${page.pageId}`,
      });
    }
  }
  return out;
}

/** Candidates for upcoming shows on a festival or tour page (see the module comment for the rules). */
export function extractWikipediaEditions(
  page: WikiPage,
  festival: WikiFestival,
  now: Date,
): WikiCandidate[] {
  const tour =
    festival.kind === "tour" || (festival.kind === undefined && isTourPage(page.wikitext));
  const found = tour ? tourEditions(page, festival, now) : festivalEditions(page, festival, now);
  const seen = new Set<string>();
  return found.filter((c) => !seen.has(c.externalId) && !!seen.add(c.externalId));
}
