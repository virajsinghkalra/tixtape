/**
 * D-082: what an event's picture is, best first. Pure and tested.
 *  1. the official poster (og:image of the official page, hotlinked);
 *  2. a collage of the headliners' Spotify photos (up to 4);
 *  3. a branded gradient with a sticker: never an empty colour block.
 */
export type EventVisualPlan =
  | { kind: "poster"; url: string }
  | { kind: "faces"; urls: string[] }
  | { kind: "fallback"; label: string };

export const MAX_FACES = 4;

export function visualFor(
  poster: string | null | undefined,
  faces: readonly (string | null | undefined)[],
  label: string,
): EventVisualPlan {
  if (poster) return { kind: "poster", url: poster };
  const urls = [...new Set(faces.filter((f): f is string => Boolean(f)))].slice(0, MAX_FACES);
  if (urls.length > 0) return { kind: "faces", urls };
  return { kind: "fallback", label };
}
