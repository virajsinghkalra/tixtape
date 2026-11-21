/**
 * Copy that depends on how many artists play (one source of truth, DRY). D-082 minimal copy:
 * 2–4 words where possible, no explanatory sentences, no song or minute counts, no Spotify-match
 * commentary. A solo show reads "Bhuwin, all night.", never "1 artists".
 */
import type { BillingTier } from "@/domain/shared/lineup";

/** "1 artist", "2 artists", "1 show". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type LineupShape = "empty" | "solo" | "duo" | "trio" | "festival";

export function lineupShape(artistCount: number): LineupShape {
  if (artistCount <= 0) return "empty";
  if (artistCount === 1) return "solo";
  if (artistCount === 2) return "duo";
  if (artistCount === 3) return "trio";
  return "festival";
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The one-line "who's playing", sized to the lineup. */
export function whoLine(names: readonly string[], total = names.length): string {
  switch (lineupShape(total)) {
    case "empty":
      return "Lineup soon 🫣";
    case "solo":
      return `${names[0]}, all night.`;
    case "duo":
      return `${joinNames(names.slice(0, 2))}. One night.`;
    case "trio":
      return `${joinNames(names.slice(0, 3))}. One night.`;
    case "festival":
      return `${plural(total, "artist")}.`;
  }
}

const TIER_NAMES: Record<BillingTier, [string, string]> = {
  headliner: ["Headliner", "Headliners"],
  sub: ["Sub-headliner", "Sub-headliners"],
  mid: ["Mid-card", "Mid-card"],
  support: ["Support", "Support"],
};

/** "Headliner" for one, "Headliners" for more. */
export function tierLabel(tier: BillingTier, count: number): string {
  const [one, many] = TIER_NAMES[tier];
  return count === 1 ? one : many;
}

/** What the share sheet says. */
export function shareText(title: string, names: readonly string[]): string {
  return names.length === 1 ? `${names[0]}, live 🎧` : `${title} 🎧`;
}

export type TitleSize = "xl" | "lg" | "md";

/** Long titles get smaller type so they never stack into four giant lines. */
export function titleSize(title: string): TitleSize {
  const length = title.trim().length;
  if (length <= 16) return "xl";
  if (length <= 30) return "lg";
  return "md";
}

/** Card teaser: "Martin Garrix, all night", "A and B", "A, B + 6 more", or a count. */
export function lineupTeaser(headliners: readonly string[], artistCount: number): string {
  if (headliners.length === 0) return plural(artistCount, "artist");
  if (artistCount === 1) return `${headliners[0]}, all night`;
  const shown = headliners.slice(0, 2);
  const more = artistCount - shown.length;
  return more > 0 ? `${shown.join(", ")} + ${more} more` : joinNames(shown);
}

// ── Story copy (one voice for the event page and the home story) ─────────

/** The story's header. Never counts slides. */
export const STORY_HEADER = "The rundown";

/** "34 acts. 2 days." Sized to the lineup and the show length. */
export function introLine(names: readonly string[], total: number, days: number): string {
  const shape = lineupShape(total);
  if (shape === "empty") return "Lineup soon 🫣";
  if (shape === "solo") return whoLine(names, total);
  const when = days > 1 ? `${days} days` : "One night";
  if (shape === "festival") return `${total} acts. ${when}.`;
  return `${joinNames(names.slice(0, total))}. ${when}.`;
}

export const STORY_KICKERS = {
  headliners: "🔥 Top of the bill",
  bill: "🎤 Don't sleep on",
  gems: (n: number) => (n === 1 ? "💎 Catch this one early" : "💎 Catch these early"),
  lineup: "🔥 The lineup",
  playlist: "🎧 The playlist",
} as const;

/** "+ 20 more", or null when everyone fits. */
export function moreLine(hidden: number): string | null {
  return hidden > 0 ? `+ ${hidden} more` : null;
}

/** Nothing matched on Spotify yet: never "0 songs · 0 min". */
export const PLAYLIST_SOON = "Playlist soon ⏳";

/** The story's last slide: a headline and two ways out (D-082). */
export const STORY_CTA = {
  headline: "Every act. One playlist.",
  playlist: "Open playlist",
  event: "See event",
} as const;
