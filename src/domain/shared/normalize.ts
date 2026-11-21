/**
 * Artist name normalization, shared by Events & Ingestion and Artist Matching (D-013, LLD §6).
 * Pure functions: no IO, no locale-dependent behaviour.
 */

/**
 * Performance-format suffixes in brackets that a lineup adds to an artist's name.
 * Only bracketed forms are stripped: a bare trailing "Live" may be part of a real name.
 */
const PERFORMANCE_SUFFIX =
  /\s*[([]\s*(?:live|live set|live act|live band|full band|dj set|dj|hybrid|hybrid set|hybrid live|a\/?v|a\/?v set|a\/?v show|audiovisual|acoustic|acoustic set|unplugged)\s*[)\]]\s*$/u;

/** Combining marks on Latin letters are diacritics; marks on other scripts (e.g. Devanagari matras) are letters. */
const LATIN_DIACRITICS = /(\p{Script=Latin})\p{M}+/gu;
const LEADING_QUALIFIER = /^(?:the|dj) (?=\S)/u;

function stripPerformanceSuffixes(name: string): string {
  let current = name;
  for (;;) {
    const stripped = current.replace(PERFORMANCE_SUFFIX, "");
    if (stripped === current || stripped.trim() === "") return current;
    current = stripped;
  }
}

function stripLeadingQualifiers(name: string): string {
  let current = name;
  while (LEADING_QUALIFIER.test(current)) current = current.replace(LEADING_QUALIFIER, "");
  return current;
}

/**
 * The comparison key for an artist name. Idempotent: `f(f(x)) === f(x)`.
 * "The Local Train (Live)" → "local train"; "Beyoncé" → "beyonce"; "Above & Beyond" → "above and beyond".
 */
export function normalizeArtistName(raw: string): string {
  const folded = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(LATIN_DIACRITICS, "$1")
    .normalize("NFC");
  const words = stripPerformanceSuffixes(folded)
    .replace(/[&+]/gu, " and ")
    // "A.R. Rahman" and "AR Rahman", "Guns N' Roses" and "Guns N Roses" compare equal.
    .replace(/['’`.]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
  return stripLeadingQualifiers(words);
}

/** "A (feat. B)" → "A feat. B", so it splits like the unbracketed form. */
const BRACKETED_FEATURE = /\s*[([]\s*((?:feat\.?|ft\.?|featuring)\s+[^)\]]+?)\s*[)\]]/giu;
/**
 * Whole-word separators only. "&" and "and" are deliberately absent: many band names contain them.
 * A standalone "x" separates only when the next word isn't another separator, so the "X" that
 * ends "Lil Nas X" survives in "Lil Nas X x Jack Harlow" and "Lil Nas X b2b Jack Harlow".
 */
const WORD_SEPARATORS = String.raw`b2b|b3b|vs\.?|versus|feat\.?|ft\.?|featuring`;
const CREDIT_SEPARATOR = new RegExp(
  String.raw`\s+(?:(?:${WORD_SEPARATORS})\s+)+|\s+[x×]\s+(?!(?:${WORD_SEPARATORS}|x|×)\s)`,
  "iu",
);

/**
 * Splits one lineup credit into the artists it names, keeping their display casing.
 * "Nucleya b2b Ritviz" → ["Nucleya", "Ritviz"]; "Simon & Garfunkel" → ["Simon & Garfunkel"].
 */
export function splitArtistCredit(raw: string): string[] {
  return raw
    .replace(BRACKETED_FEATURE, " $1")
    .split(CREDIT_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
