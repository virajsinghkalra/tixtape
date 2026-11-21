/** Recent searches, kept only in this browser. Storage can be missing or throw: never fatal. */
const KEY = "concert-playlist.recent-searches";
export const MAX_RECENT = 5;

/** Newest first, case-insensitive de-duplication. */
export function pushRecent(list: readonly string[], query: string, max = MAX_RECENT): string[] {
  const q = query.trim();
  if (!q) return [...list];
  return [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, max);
}

export function readRecent(
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): string[] {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}

export function writeRecent(
  list: readonly string[],
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // Private mode or full storage: recents are a nicety.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
