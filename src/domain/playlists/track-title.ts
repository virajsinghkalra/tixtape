/**
 * Track title rules for song picking (D-038). Pure functions.
 * Titles fold through `normalizeArtistName` so case, diacritics and punctuation compare the
 * same way everywhere (D-013, ENGINEERING.md §10.3).
 */
import { normalizeArtistName } from "@/domain/shared/normalize";

/** Alternate versions we skip when the original is available (D-038). */
export type TrackVersion =
  "live" | "remix" | "karaoke" | "sped_up" | "slowed" | "instrumental" | "acoustic";

const VERSION_PATTERNS: ReadonlyArray<readonly [TrackVersion, RegExp]> = [
  ["karaoke", /\bkaraoke\b/iu],
  ["sped_up", /\b(?:sped|speed)[\s-]?up\b|\bnightcore\b/iu],
  ["slowed", /\bslowed\b|\breverb\b/iu],
  ["instrumental", /\binstrumental\b/iu],
  ["acoustic", /\bacoustic\b|\bunplugged\b/iu],
  ["remix", /\b(?:remix|rmx|bootleg|flip)\b/iu],
  ["live", /\blive\b/iu],
];

/**
 * Words that mark a bracketed or " - " suffix as decoration rather than part of the song's
 * name: "(From "Film")", "(feat. X)", "- Remastered 2011", "(Lofi Flip)". Unknown brackets stay,
 * so "Song (Part 2)" and "Song" remain different songs.
 */
const DECORATION_WORDS =
  /\b(?:from|feat\.?|ft\.?|featuring|with|remaster(?:ed)?|version|edit|mix|remix|rmx|bootleg|flip|live|karaoke|sped|speed|slowed|reverb|instrumental|acoustic|unplugged|soundtrack|ost|radio|explicit|clean|mono|stereo|deluxe|bonus|lofi|nightcore|recorded|session|original)\b/iu;

const BRACKETED = /\s*(?:\(([^()]*)\)|\[([^[\]]*)\])/gu;
const DASH_SUFFIX = /\s+[-–—]\s+(.+)$/u;
const TRAILING_FEATURE = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/iu;

/** The decoration texts of a title: bracket contents and a " - …" suffix that look like tags. */
function decorations(title: string): string[] {
  const parts: string[] = [];
  for (const m of title.matchAll(BRACKETED)) {
    const text = m[1] ?? m[2] ?? "";
    if (DECORATION_WORDS.test(text)) parts.push(text);
  }
  const dash = DASH_SUFFIX.exec(title.replace(BRACKETED, ""));
  if (dash?.[1] && DECORATION_WORDS.test(dash[1])) parts.push(dash[1]);
  return parts;
}

/** The alternate version a title announces, or null for an original. "Live Forever" is original. */
export function trackVersion(title: string): TrackVersion | null {
  for (const text of decorations(title)) {
    for (const [version, pattern] of VERSION_PATTERNS) if (pattern.test(text)) return version;
  }
  return null;
}

/**
 * The comparison key for a song title, without version, feature, remaster or "(From …)" tags.
 * `Kesariya (From "Brahmastra")` and `Kesariya` → "kesariya"; "Tum Hi Ho - Live" → "tum hi ho".
 */
export function normalizeTrackTitle(title: string): string {
  let stripped = title.replace(BRACKETED, (whole, a?: string, b?: string) =>
    DECORATION_WORDS.test(a ?? b ?? "") ? "" : whole,
  );
  stripped = stripped.replace(DASH_SUFFIX, (whole, suffix: string) =>
    DECORATION_WORDS.test(suffix) ? "" : whole,
  );
  stripped = stripped.replace(TRAILING_FEATURE, "");
  const key = normalizeArtistName(stripped);
  return key === "" ? normalizeArtistName(title) : key;
}
