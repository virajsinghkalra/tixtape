/**
 * D-091: lineup credits are split into artists, but a known act is never split.
 * "TOMORROW X TOGETHER" is one act, not "TOMORROW" and "TOGETHER"; so are "Simon & Garfunkel"
 * and "Florence + The Machine". Separator rules stay in `splitArtistCredit` (D-013); this only
 * re-joins the parts that together name a known act, keeping the credit's own spelling.
 */
import { normalizeArtistName, splitArtistCredit } from "@/domain/shared/normalize";

/**
 * Acts whose name contains a word that usually joins two acts (x, ft, &, and, with, vs, +).
 * Data: add names here. Matching uses `normalizeArtistName`, so "&"/"and"/"+" spellings and
 * letter case don't matter.
 */
export const KNOWN_COMPOUND_ACTS: readonly string[] = [
  "Tomorrow X Together",
  "Simon & Garfunkel",
  "Salim & Sulaiman",
  "Vishal & Shekhar",
  "Earth, Wind & Fire",
  "Florence + The Machine",
  "Mumford & Sons",
  "Above & Beyond",
  "Chase & Status",
  "Camo & Krooked",
  "Dimitri Vegas & Like Mike",
  "Hall & Oates",
  "Echo & the Bunnymen",
  "Belle and Sebastian",
  "Of Monsters and Men",
  "Marina and the Diamonds",
  "Years & Years",
  "Kool & the Gang",
  "Bob Marley & The Wailers",
  "Crosby, Stills, Nash & Young",
  "Jon Batiste with Stay Human",
  "Rage Against the Machine",
];

const KNOWN_KEYS: ReadonlySet<string> = new Set(KNOWN_COMPOUND_ACTS.map(normalizeArtistName));

/** True for a name on the allow-list, whatever its spelling of "&"/"and"/"+" or case. */
export function isKnownCompoundAct(name: string): boolean {
  return KNOWN_KEYS.has(normalizeArtistName(name));
}

export type CreditOptions = {
  /** Other known acts, e.g. an existing artist or alias in the database. */
  isKnownAct?: (name: string) => boolean;
  /**
   * False keeps the credit exactly as given: verified (admin / Data-team) lineups split only
   * when the source itself lists the parts as separate entries.
   */
  split?: boolean;
};

/**
 * One credit → the acts it names, display spelling kept.
 * "Nucleya b2b Ritviz" → ["Nucleya", "Ritviz"];
 * "TOMORROW X TOGETHER" → ["TOMORROW X TOGETHER"];
 * "Tomorrow X Together x Halsey" → ["Tomorrow X Together", "Halsey"].
 */
export function splitLineupCredit(raw: string, opts: CreditOptions = {}): string[] {
  const credit = raw.trim();
  if (credit === "") return [];
  const known = (name: string) => isKnownCompoundAct(name) || (opts.isKnownAct?.(name) ?? false);
  if (opts.split === false || known(credit)) return [credit];

  const parts = splitArtistCredit(credit);
  const spans = locate(credit, parts);
  // A part we can't place in the original text (rewritten brackets): keep the plain split.
  if (spans === null) return parts;

  const out: string[] = [];
  for (let i = 0; i < parts.length;) {
    let end = i;
    for (let j = parts.length - 1; j > i; j--) {
      if (known(credit.slice(spans[i]!.start, spans[j]!.end))) {
        end = j;
        break;
      }
    }
    out.push(end === i ? parts[i]! : credit.slice(spans[i]!.start, spans[end]!.end));
    i = end + 1;
  }
  return out;
}

/** Where each part sits in `text`, in order; null if one can't be found. */
function locate(text: string, parts: readonly string[]): { start: number; end: number }[] | null {
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const part of parts) {
    const start = text.indexOf(part, cursor);
    if (start < 0) return null;
    spans.push({ start, end: start + part.length });
    cursor = start + part.length;
  }
  return spans;
}
