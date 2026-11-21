export type HighlightSegment = { text: string; match: boolean };

/** Splits `text` into segments, marking every case-insensitive occurrence of `query`. */
export function highlightMatch(text: string, query: string): HighlightSegment[] {
  const needle = query.trim().toLowerCase();
  const haystack = text.toLowerCase();
  // Lower-casing can change length for a few scripts; then indexes don't line up, so don't mark.
  if (needle.length === 0 || haystack.length !== text.length) return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, from)) {
    if (at > from) segments.push({ text: text.slice(from, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) segments.push({ text: text.slice(from), match: false });
  return segments;
}
