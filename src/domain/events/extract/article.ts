/**
 * Free extraction from news articles (P1.11, D-024, D-033): keyword filter → event name,
 * date, city and venue → candidate artist names from lineup sentences. Pure; no AI, no IO.
 * Artist names are only candidates: the collector keeps those Spotify confirms.
 */
import { createHash } from "node:crypto";
import { istDay } from "../ist-calendar";
import { foldText } from "../text";
import { knownCity } from "../venue";
import type { ArtistMention, CollectorSource, EventCandidate, SourceTrust } from "./candidate";
import { findDateRanges, type DateRange } from "./dates";
import { findCity, findVenue, KNOWN_VENUES } from "./places";

/** Indian festivals whose names alone make an article worth reading. */
export const FESTIVAL_NAMES: readonly string[] = [
  "Lollapalooza India",
  "NH7 Weekender",
  "Sunburn Festival",
  "Sunburn Arena",
  "Magnetic Fields",
  "Ziro Festival of Music",
  "Echoes of Earth",
  "Hornbill Festival",
  "Mahindra Independence Rock",
  "Mahindra Blues Festival",
  "Zomaland",
  "VH1 Supersonic",
  "Rolling Loud India",
  "Bandland",
  "HOME Festival",
  "India Cocktail Week",
];

const KEYWORDS =
  /\b(line-?ups?|to perform|will perform|headlin(?:e|es|er|ers|ing)|announc(?:e|es|ed)|india debut|india tour|live in (?:mumbai|delhi|bengaluru|bangalore|pune|goa|hyderabad|kolkata|chennai|gurugram))\b/iu;

/** The keyword filter: a lineup/announcement cue, or a known festival, and an Indian place. */
export function isLineupArticle(
  title: string,
  text: string,
  watchTerms: readonly string[] = [],
): boolean {
  const all = `${title}\n${text}`;
  const cue =
    KEYWORDS.test(all) ||
    FESTIVAL_NAMES.some((f) => includesFolded(all, f)) ||
    watchTerms.some((t) => includesFolded(all, t));
  return cue && isIndiaRelated(all);
}

/** Mentions India or an Indian city we know. */
export function isIndiaRelated(text: string): boolean {
  return /\bindia\b/iu.test(text) || findCity(text) !== null;
}

function includesFolded(text: string, phrase: string): boolean {
  return ` ${foldText(text)} `.includes(` ${foldText(phrase)} `);
}

// ── Sentences ─────────────────────────────────────────────────────────────

const ABBREVIATION =
  /(?:^|[\s.])(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|co|mr|mrs|ms|dr|st|jr|sr|vol|no|ft|feat|vs|inc|ltd|[\p{Lu}])\.$/iu;

/** Splits text into sentences without breaking after "Feb.", "Co." or initials ("A.R."). */
export function sentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    let current = "";
    for (const piece of line.split(/(?<=[.!?])\s+/u)) {
      current = current === "" ? piece : `${current} ${piece}`;
      if (!ABBREVIATION.test(current)) {
        out.push(current.trim());
        current = "";
      }
    }
    if (current.trim() !== "") out.push(current.trim());
  }
  return out.filter((s) => s !== "");
}

/** Quoted spans are song titles or statements, never lineups. Applied before sentence splitting. */
function withoutQuotes(text: string): string {
  return text.replace(/“[^”]{0,600}”|"[^"\n]{0,600}"|‘[^’]{1,80}’/gu, " ");
}

/** Feed boilerplate: "The post … appeared first on Rolling Stone India." */
const BOILERPLATE = /\bappeared first on\b/iu;

// ── Artist mentions ───────────────────────────────────────────────────────

const LINEUP_CUE =
  /\b(line-?ups?|perform\w*|headlin\w*|featur\w*|alongside|joined by|debut\w*|b2b|support\w*|includ\w*|such as|artists?|acts?|will play|set to play|take the stage|bill)\b/iu;

/** Capitalised words that start sentences or describe acts, but are never an act on their own. */
const STOP_WORDS = new Set(
  `the a an this that these those it its he she they his her their we our i you in on at for and
   with from by but also after before while as if when alongside known over every speaking today
   because together however meanwhile according following last next earlier later now here there
   what where who why how during since until both each all more most other such only just even
   still yet so then than featuring starring including get experience join joining witness catch watch enjoy book grab
   celebrate discover rescheduled announced presenting introducing asia europe africa america uk usa us world headliners headliner headlining joining joined though although whether not no yes new first second third special ahead
   live plus tickets ticket presale india indian american british english canadian australian
   german dutch french swedish norwegian korean k-pop japanese punjabi bollywood pop rock hip-hop
   grammy grammy-winning legendary global international national edm dj singer rapper producer
   band festival concert tour lineup line-up monday tuesday wednesday thursday friday saturday
   sunday january february march april may june july august september october november december
   jan feb mar apr jun jul aug sep sept oct nov dec bookmyshow district instagram spotify youtube`
    .split(/\s+/u)
    .filter(Boolean)
    .map(foldText),
);

/** A phrase containing one of these names an event, venue or company, not an act. */
const NON_ARTIST_WORDS =
  /\b(festival|fest|weekender|tour|edition|stage|records|entertainment|productions|presents|stadium|ground|grounds|arena|dome|racecourse|centre|center|club|garden|tickets?|awards?|album|ep|single|music week)\b/iu;

/** The run right after one of these words is a title ("his latest album I Know Too Much"). */
const TITLE_INTRODUCERS = new Set([
  "album",
  "albums",
  "single",
  "song",
  "songs",
  "ep",
  "film",
  "track",
  "titled",
  "called",
]);

/** Starts with a capital letter or digit and contains a letter; not an ordinal ("20th"). */
const CAPITALISED = /^(?=.*\p{L})[\p{Lu}\d][\p{L}\p{M}\d'’.!$&-]*$/u;
const ORDINAL = /^\d+(?:st|nd|rd|th)$/iu;
const CONTRACTION = /['’](?:ve|m|ll|re|d)$/iu;
/** Lowercase words allowed inside a name when a capitalised word follows ("Florence and the Machine"). */
const JOINERS = new Set([
  "&",
  "and",
  "x",
  "×",
  "the",
  "of",
  "n",
  "n'",
  "de",
  "la",
  "da",
  "y",
  "b2b",
]);

type Token = { word: string; breakAfter: boolean };

function tokens(sentence: string): Token[] {
  const out: Token[] = [];
  for (const raw of sentence.split(/\s+/u)) {
    if (raw === "") continue;
    const breakAfter = /[,;:()]$/u.test(raw);
    const word = raw
      .replace(/^[(“"‘[]+/u, "")
      .replace(/[,;:)”"\]]+$/u, "")
      .replace(/(?:’s|'s)$/u, "")
      .replace(/[.!?]$/u, (p) => (/^(?:[\p{Lu}]|co|jr|sr)\.$/iu.test(raw) ? p : ""));
    if (word === "") {
      if (out.length > 0 && breakAfter) out[out.length - 1]!.breakAfter = true;
      continue;
    }
    out.push({ word, breakAfter });
  }
  return out;
}

const isNameWord = (w: string) => CAPITALISED.test(w) && !ORDINAL.test(w) && !CONTRACTION.test(w);

/** Runs of capitalised words, joined across "&", "and", "x", "the", "of" and "b2b". */
function capitalisedRuns(sentence: string): string[][] {
  const words = tokens(sentence);
  const runs: string[][] = [];
  let run: string[] = [];
  let isTitle = false;
  const flush = () => {
    while (run.length > 0 && JOINERS.has(run[run.length - 1]!.toLowerCase())) run.pop();
    if (run.length > 0 && !isTitle) runs.push(run);
    run = [];
    isTitle = false;
  };
  for (let i = 0; i < words.length; i++) {
    const t = words[i]!;
    const next = words[i + 1];
    const lower = t.word.toLowerCase();
    if (isNameWord(t.word)) {
      if (run.length === 0) isTitle = TITLE_INTRODUCERS.has(words[i - 1]?.word.toLowerCase() ?? "");
      run.push(t.word);
    } else if (
      run.length > 0 &&
      JOINERS.has(lower) &&
      next !== undefined &&
      isNameWord(next.word)
    ) {
      run.push(lower === "and" || lower === "x" || lower === "b2b" ? lower : t.word);
    } else {
      flush();
    }
    if (t.breakAfter) flush();
  }
  flush();
  return runs;
}

const FESTIVAL_KEYS = FESTIVAL_NAMES.map(foldText);

/** A usable name, or null for stop words, places, venues, festivals and event phrases. */
function usable(name: string): string | null {
  const folded = foldText(name);
  if (folded === "" || STOP_WORDS.has(folded) || /^\d+$/u.test(folded)) return null;
  // "American EDM", "Swedish DJ": only describers, no name.
  if (folded.split(" ").every((p) => STOP_WORDS.has(p) || DESCRIBERS.has(p))) return null;
  if (NON_ARTIST_WORDS.test(name) || name.length > 60) return null;
  if (knownCity(folded) !== null) return null;
  if (KNOWN_VENUES.some((v) => foldText(v.name) === folded)) return null;
  // "Sunburn" alone is the festival brand, not an act.
  if (FESTIVAL_KEYS.some((f) => f === folded || f.startsWith(`${folded} `))) return null;
  return name;
}

/** Role words that describe an act ("DJ-producer", "singer-songwriter", "pop star"). */
const DESCRIBERS = new Set(
  `dj producer singer songwriter rapper artist duo trio group band star superstar hitmaker
   sensation legend icon composer musician vocalist frontman pioneer maestro`
    .split(/\s+/u)
    .filter(Boolean),
);

/** A stop word, or a describer made only of role words ("DJ-producer" → "dj producer"). */
function isLeadingDescriber(word: string): boolean {
  const folded = foldText(word);
  if (STOP_WORDS.has(folded)) return true;
  const parts = folded.split(" ").filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((p) => DESCRIBERS.has(p) || STOP_WORDS.has(p)) &&
    word.includes("-")
  );
}

/**
 * The name as written, then with leading describers removed one at a time
 * ("French DJ-producer DJ Snake" → "DJ-producer DJ Snake" → "DJ Snake" → "Snake").
 * Callers try them in order and keep the first Spotify confirms, so "DJ Snake" wins.
 */
function forms(words: readonly string[]): string[] {
  const w = [...words];
  const out: string[] = [];
  const add = () => {
    const name = usable(w.join(" "));
    if (name && !out.includes(name)) out.push(name);
  };
  add();
  while (w.length > 1 && isLeadingDescriber(w[0]!)) {
    w.shift();
    add();
  }
  return out;
}

/** Forms as a chain: each is tried only if the longer one isn't an artist. */
function chain(names: readonly string[]): ArtistMention | null {
  let mention: ArtistMention | null = null;
  for (const name of [...names].reverse()) mention = { name, parts: mention ? [mention] : [] };
  return mention;
}

function splitOn(words: readonly string[], separators: ReadonlySet<string>): string[][] {
  const parts: string[][] = [[]];
  for (const word of words) {
    if (separators.has(word.toLowerCase())) parts.push([]);
    else parts[parts.length - 1]!.push(word);
  }
  return parts.filter((p) => p.length > 0);
}

/** The name as written, with its describer-free form as the fallback. */
function withForms(words: readonly string[]): ArtistMention[] {
  const m = chain(forms(words));
  return m ? [m] : [];
}

/** "and"/"x" separate acts more often than "&", so they are split first. */
const SPLIT_LEVELS: readonly ReadonlySet<string>[] = [new Set(["and", "x", "×"]), new Set(["&"])];

function build(words: readonly string[], levels: readonly ReadonlySet<string>[]): ArtistMention[] {
  const [level, ...deeper] = levels;
  if (!level) return withForms(words);
  if (!words.some((w) => level.has(w.toLowerCase()))) return build(words, deeper);
  const pieces = splitOn(words, level).flatMap((p) => build(p, deeper));
  const [whole, ...rest] = forms(words);
  if (!whole) return pieces;
  const shorter = chain(rest);
  return [{ name: whole, parts: [...(shorter ? [shorter] : []), ...pieces] }];
}

/**
 * One capitalised run → mentions. "b2b" always separates; "&"/"and"/"x" may be part of a
 * name, so the whole run is tried first and its pieces are the fallback. A run that contains
 * a festival or venue word ("Johnnie & Co. Festival") yields nothing.
 */
function mentionsFromRun(run: readonly string[]): ArtistMention[] {
  if (NON_ARTIST_WORDS.test(run.join(" "))) return [];
  return splitOn(run, new Set(["b2b"])).flatMap((credit) => build(credit, SPLIT_LEVELS));
}

const allNames = (m: ArtistMention): string[] => [m.name, ...m.parts.flatMap(allNames)];

/** Sentences about past shows ("Avicii's performance in 2011", "headlined last year") aren't lineups. */
const PAST_TENSE =
  /\b(performed|played|hosted|headlined|last year|previous edition|past editions?)\b/iu;

function aboutThePast(sentence: string, currentYear: number): boolean {
  if (PAST_TENSE.test(sentence)) return true;
  return [...sentence.matchAll(/\b(19\d\d|20\d\d)\b/gu)].some((m) => Number(m[1]) < currentYear);
}

/**
 * Candidate artist names from the lineup sentences of an article body, in reading order.
 * Sentences about past years are skipped. A single word that is the surname of a longer
 * mention ("Puth" after "Charlie Puth") is dropped.
 */
export function extractArtistMentions(text: string, now: Date): ArtistMention[] {
  const currentYear = istDay(now).year;
  const mentions: ArtistMention[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(withoutQuotes(text))) {
    if (!LINEUP_CUE.test(sentence) || BOILERPLATE.test(sentence)) continue;
    if (aboutThePast(sentence, currentYear)) continue;
    for (const run of capitalisedRuns(sentence)) {
      for (const m of mentionsFromRun(run)) {
        const key = foldText(m.name);
        if (seen.has(key)) continue;
        seen.add(key);
        mentions.push(m);
      }
    }
  }
  const longNames = mentions.flatMap(allNames).filter((n) => n.includes(" "));
  return mentions.filter(
    (m) =>
      m.name.includes(" ") ||
      !longNames.some((n) => foldText(n).split(" ").includes(foldText(m.name))),
  );
}

// ── Event name, date, place ───────────────────────────────────────────────

const EVENT_NAME =
  /((?:[\p{Lu}\d][\p{L}\d'’.]*\s+(?:(?:&|and|of|the|x)\s+)?){1,6}(?:Festival|Fest|Weekender|Carnival)(?:\s+(?:20\d\d))?)/u;

/** "Sunburn Festival 2026", "Johnnie & Co. Festival": a known festival, else a "… Festival" phrase. */
export function findEventName(text: string): string | null {
  // The earliest-mentioned known festival: an aside ("…which also hosts Lollapalooza India")
  // comes after the subject.
  let best: { at: number; name: string } | null = null;
  for (const name of FESTIVAL_NAMES) {
    const m = new RegExp(String.raw`${escape(name)}(?:\s+(20\d\d)\b)?`, "iu").exec(text);
    if (m && (best === null || m.index < best.at)) {
      best = { at: m.index, name: m[1] ? `${name} ${m[1]}` : name };
    }
  }
  if (best) {
    // Prefer the same name with its year when the text gives one anywhere.
    const withYear = new RegExp(String.raw`${escape(best.name)}\s+(20\d\d)\b`, "iu").exec(text);
    return withYear ? `${best.name} ${withYear[1]}` : best.name;
  }
  const m = EVENT_NAME.exec(text);
  if (!m?.[1]) return null;
  const words = m[1].trim().split(/\s+/u);
  while (words.length > 2 && STOP_WORDS.has(foldText(words[0]!))) words.shift();
  return words.join(" ");
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const NOT_EVENT_DATE =
  /\b(tickets?|pre-?sale|on sale|sales?|registrations?|early bird|released|releases|album|single|birthday|died|born)\b/iu;

/** The first upcoming date in a sentence that isn't about ticket sales or releases. */
/**
 * A date without a year is read relative to when the article was published ("December 28th"
 * in a 2023 post is 2023), then it must still be upcoming now.
 */
function eventDate(
  text: string,
  now: Date,
  publishedAt: Date | null,
): { range: DateRange; sentence: string } | null {
  const earliest = now.getTime() - 86_400_000;
  for (const sentence of sentences(text)) {
    if (NOT_EVENT_DATE.test(sentence)) continue;
    // Without a publish date there is nothing to read a year-less date against: drop it.
    const found = publishedAt
      ? findDateRanges(sentence, publishedAt, { inferYear: true })
      : findDateRanges(sentence, now);
    for (const range of found) {
      if ((range.end ?? range.start).getTime() >= earliest) return { range, sentence };
    }
  }
  return null;
}

export type Article = {
  source: CollectorSource;
  trust: SourceTrust;
  externalId: string;
  url: string;
  title: string;
  /** Plain text (see `htmlToText`). */
  text: string;
  /** Watch-list terms (D-050): an article naming one counts as a lineup cue. */
  watchTerms?: readonly string[];
  /** When the article was published; year-less dates are read relative to it, else dropped. */
  publishedAt?: Date;
};

const FESTIVAL_ACTS = 6;
/** Only the headline decides: body text often mentions earlier postponements. */
export const CANCELLED = /\b(cancell?ed|called off|postponed)\b/iu;

/**
 * Syndicated copies of one press release (D-056) share their opening: the first 40 words,
 * folded, identify the text. Different outlets' own reporting differs here.
 */
export function textFingerprint(text: string): string {
  const words = foldText(text).split(" ").filter(Boolean).slice(0, 40);
  return `text:${createHash("sha256").update(words.join(" ")).digest("hex").slice(0, 16)}`;
}

/**
 * One event candidate from an article, or null when it isn't about an upcoming Indian event
 * (no cue, no upcoming date, or no Indian city). `title` is null when the article names no
 * event; the collector then titles it after the first confirmed artist.
 */
export function extractArticleCandidate(article: Article, now: Date): EventCandidate | null {
  if (!isLineupArticle(article.title, article.text, article.watchTerms)) return null;
  const publishedAt = article.publishedAt ?? null;
  const dated = eventDate(article.text, now, publishedAt);
  if (!dated) return null;
  const venue = findVenue(dated.sentence) ?? findVenue(article.text);
  const city = venue?.city ?? findCity(dated.sentence) ?? findCity(article.text);
  if (!city) return null;
  // The headline picks the event; the body may add its year ("Sunburn Festival" → "… 2026").
  const fromTitle = findEventName(article.title);
  const fromText = findEventName(article.text);
  const name = fromTitle && fromText?.startsWith(fromTitle) ? fromText : (fromTitle ?? fromText);
  const cancelled = CANCELLED.test(article.title);
  const artists = extractArtistMentions(article.text, publishedAt ?? now);
  const festival = name !== null || artists.length >= FESTIVAL_ACTS;
  let confidence = 0.3;
  if (KEYWORDS.test(article.title)) confidence += 0.1;
  confidence += dated.range.yearGiven ? 0.2 : 0.1;
  if (venue) confidence += 0.2;
  if (name) confidence += 0.1;
  if (artists.length > 0) confidence += 0.1;
  return {
    source: article.source,
    trust: article.trust,
    externalId: article.externalId,
    url: article.url,
    title: name,
    type: festival ? "festival" : "concert",
    startsAt: dated.range.start,
    endsAt: dated.range.end,
    city,
    country: "IN",
    venueName: venue?.name ?? null,
    ...(cancelled ? { cancelled: true } : {}),
    dateExplicit: dated.range.yearGiven,
    fingerprint: textFingerprint(article.text),
    artists,
    confidence: Math.min(1, Math.round(confidence * 100) / 100),
  };
}

const TOUR_KEYWORD = /\s+(?:tour|live|in concert)\b/iu;
const REGION_WORDS = /(?:\s+(?:india|world|asia|global|north|america|europe|the|\d{4}))+$/iu;

/**
 * The touring act in a show title ("Prateek Kuhad Live in Mumbai", "Darshan Raval's Love Letters
 * India Tour 2026", "Arijit Singh India Tour 2027"). Where the name ends is ambiguous, so the
 * mention tries the longest prefix first and shorter ones as fallbacks; Spotify decides.
 */
export function actFromEventTitle(title: string): ArtistMention | null {
  const at = TOUR_KEYWORD.exec(title.trim());
  if (!at) return null;
  let prefix = title.trim().slice(0, at.index);
  const possessive = /^(.+?)['’]s\b/u.exec(prefix);
  prefix = possessive?.[1] ?? prefix.replace(REGION_WORDS, "");
  const words = prefix.split(/\s+/u).filter(Boolean).slice(0, 4);
  let mention: ArtistMention | null = null;
  for (let n = 1; n <= words.length; n++) {
    const name = words.slice(0, n).join(" ");
    if (STOP_WORDS.has(foldText(name))) continue;
    mention = { name, parts: mention ? [mention] : [] };
  }
  return mention;
}
