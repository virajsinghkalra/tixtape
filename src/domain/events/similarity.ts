/**
 * String and set similarity measures used by venue matching and event dedupe (LLD §5.3).
 * Pure functions, each returning a score in [0, 1].
 */

/** Jaro similarity: matching characters within a window, penalised for transpositions. */
function jaro(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

/** Jaro-Winkler with the standard prefix scale 0.1 over at most 4 characters. */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }
  return j + prefix * 0.1 * (1 - j);
}

/** |A ∩ B| / |A ∪ B|. Two empty sets score 0: no evidence is not agreement. */
export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let shared = 0;
  for (const x of setA) if (setB.has(x)) shared++;
  return shared / (setA.size + setB.size - shared);
}

/** Sørensen–Dice overlap: 2|A ∩ B| / (|A| + |B|). Kinder than Jaccard to an extra word. */
export function diceOverlap<T>(a: Iterable<T>, b: Iterable<T>): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size + setB.size === 0) return 0;
  let shared = 0;
  for (const x of setA) if (setB.has(x)) shared++;
  return (2 * shared) / (setA.size + setB.size);
}
