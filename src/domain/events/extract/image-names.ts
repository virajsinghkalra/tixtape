/**
 * Official sites publish lineups as images (D-033). Their upload file names sometimes carry
 * artist names ("Sunburn-2026-Lineup-Martin-Garrix-Alan-Walker.jpg"). Only file names that say
 * "lineup" are read, and every name is still validated against Spotify by the collector.
 */
import type { ArtistMention } from "./candidate";

const NOISE = new Set([
  "lineup",
  "line",
  "up",
  "phase",
  "poster",
  "banner",
  "website",
  "web",
  "square",
  "story",
  "post",
  "final",
  "copy",
  "of",
  "image",
  "img",
  "min",
  "scaled",
  "sunburn",
  "festival",
  "fest",
  "india",
  "mumbai",
  "goa",
  "artists",
  "artist",
  "and",
  "with",
  "feat",
  "ft",
]);

/** "Sunburn-2026-Lineup-Martin-Garrix--Alan-Walker-1080x1080.webp" → ["Martin Garrix", "Alan Walker"]. */
export function artistsFromImageName(fileName: string): ArtistMention[] {
  const base = decodeURIComponent(fileName.split("/").pop() ?? "")
    .replace(/\.[a-z0-9]{2,5}$/iu, "")
    .replace(/-\d+x\d+$/iu, "");
  if (!/line[-_ ]?up/iu.test(base)) return [];
  // A double separator or "_" separates names; a single "-" separates words in one name.
  const groups = base.split(/--+|_+|\s*\|\s*/u);
  const out: ArtistMention[] = [];
  for (const group of groups) {
    const words = group
      .split("-")
      .filter((w) => w !== "" && !/\d/u.test(w) && !NOISE.has(w.toLowerCase()));
    if (words.length === 0) continue;
    // Without a double separator, a run like "Martin-Garrix-Alan-Walker" is ambiguous: pair words.
    if (groups.length === 1 && words.length > 3) {
      for (let i = 0; i < words.length; i += 2) {
        out.push({ name: words.slice(i, i + 2).join(" "), parts: [] });
      }
    } else {
      out.push({ name: words.join(" "), parts: [] });
    }
  }
  return out;
}
