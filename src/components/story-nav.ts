/** The show before (-1) or after (1) `id` in the ring row, or null at either end. */
export function adjacentShow(ids: readonly string[], id: string, step: 1 | -1): string | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  return ids[i + step] ?? null;
}
