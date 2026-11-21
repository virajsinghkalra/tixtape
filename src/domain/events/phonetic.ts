/**
 * Transliteration-tolerant keys for Indian names (D-047 §5): "diljeet" ≈ "diljit",
 * "badshaah" ≈ "badshah", "shreya" ≈ "sreya". The rules are data so the SQL adapter can
 * build the identical expression (see `phoneticSqlSteps`), keeping both sides in step.
 * Input is folded text (`foldText`); the output is only a comparison key, never displayed.
 */
import { jaroWinkler } from "./similarity";

/** Literal replacements, applied in order. Vowel pairs go first so "ee" doesn't collapse to "e". */
export const PHONETIC_REPLACEMENTS: ReadonlyArray<readonly [from: string, to: string]> = [
  ["ee", "i"],
  ["oo", "u"],
  ["aa", "a"],
];

/** Applied after doubled letters collapse ("shh" → "sh" → "s"). */
export const PHONETIC_AFTER_DOUBLES: ReadonlyArray<readonly [from: string, to: string]> = [
  ["sh", "s"],
  ["ph", "f"],
  ["bh", "b"],
  ["dh", "d"],
  ["kh", "k"],
  ["gh", "g"],
  ["th", "t"],
  ["w", "v"],
];

/**
 * Doubled Latin letters ("ll" → "l"), as literal pairs rather than a regex: Postgres
 * `replace()` and JS `replaceAll` treat them identically, and it is several times cheaper
 * than `regexp_replace` per row. A triple letter becomes a double; that's rare in names.
 */
export const PHONETIC_DOUBLES: ReadonlyArray<readonly [from: string, to: string]> = [
  ..."abcdefghijklmnopqrstuvwxyz",
].map((c) => [c + c, c] as const);

/** Every replacement in order: vowel pairs, doubled letters, then consonant clusters. */
const ALL_STEPS = [...PHONETIC_REPLACEMENTS, ...PHONETIC_DOUBLES, ...PHONETIC_AFTER_DOUBLES];

/** "lollapalooza" → "lolapaluza", "diljeet dosanjh" → "diljit dosanj". */
export function phoneticKey(folded: string): string {
  let s = folded;
  for (const [from, to] of ALL_STEPS) s = s.replaceAll(from, to);
  return s;
}

/** The same steps for SQL, as literal `replace()` calls the adapter nests around a column. */
export type PhoneticSqlStep = { from: string; to: string };

export function phoneticSqlSteps(): PhoneticSqlStep[] {
  return ALL_STEPS.map(([from, to]) => ({ from, to }));
}

/** At or above this, a typed name counts as the same name spelled differently ("arjit" ~ "arijit"). */
export const NAME_MATCH_THRESHOLD = 0.9;

/**
 * Word-level name similarity on phonetic keys: each typed word is paired with its closest
 * word in the name (Jaro-Winkler), and the scores are averaged. Catches dropped vowels that
 * trigrams score low ("arjit" vs "arijit": trigram 0.44, this 0.97). Inputs are folded.
 */
export function phoneticNameSimilarity(query: string, name: string): number {
  const typed = query.split(" ").filter(Boolean).map(phoneticKey);
  const words = name.split(" ").filter(Boolean).map(phoneticKey);
  if (typed.length === 0 || words.length === 0) return 0;
  const best = typed.map((t) => Math.max(...words.map((w) => jaroWinkler(t, w))));
  return best.reduce((a, b) => a + b, 0) / best.length;
}
