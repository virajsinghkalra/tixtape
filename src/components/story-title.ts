/**
 * The short name in "Your Lolla in 5 slides": the first word with a letter, skipping "Tour".
 * Symbol-only titles ("+−=÷× Tour") fall back to "gig".
 */
export function shortName(title: string): string {
  return title.split(/\s+/).find((w) => /\p{L}/u.test(w) && !/^tour$/i.test(w)) ?? "gig";
}
