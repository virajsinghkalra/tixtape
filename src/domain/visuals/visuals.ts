/**
 * D-083: how any artist or event is pictured. Pure and tested; the UI never picks images itself.
 *  - `artistVisual`: Spotify photo → alternate (CC) photo with its credit → designed fallback.
 *  - `eventVisual`: official poster → headliner collage (photos first, fallbacks fill) → fallback
 *    (only when there's no lineup).
 *  - `orderForVisuals` / `lineupLayout`: deterministic order and sizes for any lineup size.
 * The fallback is seeded from a name hash, so the same artist always looks the same.
 */
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";

export type VisualArtist = {
  name: string;
  imageUrl: string | null;
  /** D-083: an alternate photo (e.g. Wikimedia Commons) and its attribution, from data. */
  altImageUrl?: string | null;
  altImageCredit?: string | null;
  tier?: BillingTier;
  billingRank?: number;
};

/** The palette the fallback draws from (block tones; the UI maps them to tokens). */
export const VISUAL_TONES = ["lime", "pink", "violet", "orange", "sky"] as const;
export type VisualTone = (typeof VISUAL_TONES)[number];

export type ArtistVisual =
  | { kind: "photo"; url: string; credit: string | null }
  | { kind: "fallback"; initials: string; from: VisualTone; to: VisualTone; angle: number };

/** FNV-1a over the normalised name: stable across runs, machines and casing. */
export function nameHash(name: string): number {
  let h = 0x811c9dc5;
  for (const ch of name.normalize("NFC").trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️]/gu;
/** Collab joiners: "A & B", "A x B", "A ft. B", "A feat. B", "A and B", "A vs B", "A, B". */
const JOIN = /\s+(?:&|\+|x|×|ft\.?|feat\.?|and|vs\.?|with)\s+|\s*,\s*/iu;

/** The first user-perceived character (keeps Devanagari/Gurmukhi conjuncts and marks together). */
function firstGrapheme(word: string): string {
  const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  for (const { segment } of seg.segment(word)) return segment.toLocaleUpperCase();
  return "";
}

const words = (s: string) =>
  s
    .replace(EMOJI, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s'’.-]/gu, " ")
    .split(/\s+/u)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, ""))
    .filter(Boolean);

/**
 * Chunky fallback text for any name: a short single word as-is ("KING", "HENGE"); collabs as
 * "S&S"; two-word names as initials ("YD"); scripts without case keep their first grapheme;
 * nothing usable (an emoji-only name) gives "♪".
 */
export function initialsOf(name: string): string {
  const parts = name
    .split(JOIN)
    .map(words)
    .filter((p) => p.length > 0);
  if (parts.length >= 2)
    return parts
      .slice(0, 2)
      .map((p) => firstGrapheme(p[0]!))
      .join("&");
  const w = parts[0] ?? [];
  if (w.length === 0) return "♪";
  if (w.length === 1) {
    const only = w[0]!;
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(only)];
    return graphemes.length <= 5 ? only.toLocaleUpperCase() : firstGrapheme(only);
  }
  return firstGrapheme(w[0]!) + firstGrapheme(w[1]!);
}

export function artistVisual(a: VisualArtist): ArtistVisual {
  if (a.imageUrl) return { kind: "photo", url: a.imageUrl, credit: null };
  if (a.altImageUrl) return { kind: "photo", url: a.altImageUrl, credit: a.altImageCredit ?? null };
  const h = nameHash(a.name);
  const from = VISUAL_TONES[h % VISUAL_TONES.length]!;
  const rest = VISUAL_TONES.filter((t) => t !== from);
  const to = rest[(h >>> 8) % rest.length]!;
  return {
    kind: "fallback",
    initials: initialsOf(a.name),
    from,
    to,
    angle: 90 + ((h >>> 16) % 4) * 45,
  };
}

export const hasPhoto = (a: VisualArtist) => Boolean(a.imageUrl || a.altImageUrl);

/** Billing tier, then artists with a photo, then billing rank, then name: stable for any mix. */
export function orderForVisuals<T extends VisualArtist>(artists: readonly T[]): T[] {
  const tier = (a: T) => (a.tier ? BILLING_TIERS.indexOf(a.tier) : 0);
  return [...artists].sort(
    (a, b) =>
      tier(a) - tier(b) ||
      Number(hasPhoto(b)) - Number(hasPhoto(a)) ||
      (a.billingRank ?? 0) - (b.billingRank ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

export type EventVisualPlan =
  | { kind: "poster"; url: string }
  | { kind: "collage"; artists: VisualArtist[] }
  | { kind: "fallback"; label: string; from: VisualTone; to: VisualTone };

export const MAX_COLLAGE = 4;

/**
 * Poster first; else a collage of the top-billed tier (photos first, designed fallbacks fill, up
 * to 4; borrowing photos from lower tiers when the top tier has none); else, with no lineup at
 * all, a branded fallback with a sticker label.
 */
export function eventVisual(e: {
  posterUrl?: string | null;
  artists: readonly VisualArtist[];
  label: string;
}): EventVisualPlan {
  if (e.posterUrl) return { kind: "poster", url: e.posterUrl };
  const ordered = orderForVisuals(e.artists);
  const topTier = ordered[0]?.tier;
  const top = ordered.filter((a) => a.tier === topTier);
  const pool = top.some(hasPhoto) || !ordered.some(hasPhoto) ? top : ordered;
  if (pool.length > 0) return { kind: "collage", artists: pool.slice(0, MAX_COLLAGE) };
  const fb = artistVisual({ name: e.label, imageUrl: null });
  return fb.kind === "fallback"
    ? { kind: "fallback", label: e.label, from: fb.from, to: fb.to }
    : { kind: "fallback", label: e.label, from: "violet", to: "pink" };
}

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type LineupBucket = "empty" | "solo" | "duo" | "trio" | "small" | "medium" | "large";

export type LineupLayout = {
  bucket: LineupBucket;
  /** Avatars in the intro face stack. */
  faceStack: number;
  /** Chips per story tier slide before "+N" (the rest go in the avatar-stack chip). */
  perSlide: Record<BillingTier, number>;
  /** Avatar size per tier on the lineup poster and the story. */
  size: Record<BillingTier, AvatarSize>;
};

/** One table for every lineup size: 0, 1, 2, 3, 4–8, 9–40 and 41+ artists. */
export function lineupLayout(total: number): LineupLayout {
  const bucket: LineupBucket =
    total <= 0
      ? "empty"
      : total === 1
        ? "solo"
        : total === 2
          ? "duo"
          : total === 3
            ? "trio"
            : total <= 8
              ? "small"
              : total <= 40
                ? "medium"
                : "large";
  const roomy = bucket !== "medium" && bucket !== "large";
  return {
    bucket,
    faceStack: Math.min(total, 5),
    perSlide: roomy
      ? { headliner: 8, sub: 8, mid: 8, support: 8 }
      : { headliner: 4, sub: 6, mid: 6, support: 6 },
    size:
      bucket === "large"
        ? { headliner: "lg", sub: "md", mid: "xs", support: "xs" }
        : bucket === "medium"
          ? { headliner: "xl", sub: "md", mid: "sm", support: "sm" }
          : { headliner: "xl", sub: "lg", mid: "md", support: "md" },
  };
}

/**
 * D-084 image weight: ask the CDN for a size that fits the slot. Wikimedia thumbs are resized
 * by the `/NNNpx-` path segment; Spotify artist images come in 640/320/160 under different
 * prefixes. Unknown hosts are returned unchanged.
 */
export function sizedImage(url: string, slot: "avatar" | "card" | "hero"): string {
  try {
    const u = new URL(url);
    if (u.hostname === "upload.wikimedia.org" && /\/thumb\//.test(u.pathname)) {
      const px = slot === "hero" ? 500 : 250;
      return url.replace(/\/(\d+)px-([^/]+)$/, `/${px}px-$2`);
    }
    if (u.hostname === "i.scdn.co") {
      const prefix =
        slot === "hero"
          ? "ab6761610000e5eb"
          : slot === "card"
            ? "ab67616100005174"
            : "ab6761610000f178";
      return url.replace(/\/image\/ab676161(0000e5eb|00005174|0000f178)/, `/image/${prefix}`);
    }
  } catch {
    // not a URL: leave it
  }
  return url;
}
