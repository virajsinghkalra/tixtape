/**
 * Text folding shared by venue, city and event-title comparison.
 * Lowercase, strip Latin diacritics, "&" → "and", drop apostrophes and periods,
 * and turn any other punctuation into a single space.
 */
export function foldText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
    .normalize("NFC")
    .replace(/[&+]/gu, " and ")
    .replace(/['’`.]/gu, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}
