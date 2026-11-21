/**
 * D-084 (UX plan #1, OD-1): what an event's link-preview card says and shows. Pure, so it's
 * tested without rendering. No song counts or durations (D-082).
 */
import { orderForVisuals, type VisualArtist } from "@/domain/visuals/visuals";
import { eventTone } from "../event-color";
import { istDayNumber, istParts } from "../event-format";
import type { BlockTone } from "../ui/tone";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const MAX_PICTURES = 4;

export const TONE_HEX: Record<BlockTone, string> = {
  lime: "#c6f432",
  pink: "#ff5fa2",
  violet: "#6a4df5",
  orange: "#ff8a3d",
  sky: "#5cc8ff",
};

export type OgEventInput = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  city: string | null;
  posterUrl: string | null;
  lineup: readonly VisualArtist[];
  playlistLive: boolean;
};

export type OgCardPlan = {
  title: string;
  titleSize: number;
  dateLine: string;
  names: string;
  tone: string;
  /** The poster alone, or up to 4 artist photos (best billed first). Empty = typographic. */
  pictures: string[];
  /** Posters are framed from the centre; photos from near the top, so faces stay in (D-083). */
  focus: "center" | "top";
  sticker: string;
  alt: string;
};

/** "18 Dec", "18–19 Dec", "31 Dec – 1 Jan". */
export function shortDateRange(startsAt: Date, endsAt: Date | null): string {
  const s = istParts(startsAt);
  if (!endsAt || istDayNumber(endsAt) <= istDayNumber(startsAt)) return `${s.day} ${s.month}`;
  const e = istParts(endsAt);
  return s.month === e.month
    ? `${s.day}–${e.day} ${s.month}`
    : `${s.day} ${s.month} – ${e.day} ${e.month}`;
}

/** Big for short titles, stepping down so long ones stay within 3 lines of the left column. */
export function titleSizeFor(title: string): number {
  const n = [...title].length;
  if (n <= 24) return 76;
  if (n <= 40) return 64;
  if (n <= 64) return 52;
  return 44;
}

export function planOgCard(e: OgEventInput): OgCardPlan {
  const ordered = orderForVisuals(e.lineup);
  const title = [...e.title].length > 90 ? `${[...e.title].slice(0, 89).join("")}…` : e.title;
  const dateLine = [shortDateRange(e.startsAt, e.endsAt), e.city].filter(Boolean).join(" · ");
  const photos = ordered
    .map((a) => a.imageUrl ?? a.altImageUrl ?? null)
    .filter((u): u is string => Boolean(u))
    .slice(0, MAX_PICTURES);
  return {
    title,
    titleSize: titleSizeFor(title),
    dateLine,
    names: ordered
      .slice(0, 4)
      .map((a) => a.name)
      .join(" · "),
    tone: TONE_HEX[eventTone(e.id)],
    pictures: e.posterUrl ? [e.posterUrl] : photos,
    focus: e.posterUrl ? "center" : "top",
    sticker: e.playlistLive ? "Playlist live" : "Playlist soon",
    alt: `${e.title}, ${dateLine}`,
  };
}

/** Changes whenever the card would look different, so WhatsApp's per-URL cache refreshes. */
export function ogVersion(plan: OgCardPlan): string {
  const text = [plan.title, plan.dateLine, plan.names, plan.sticker, ...plan.pictures].join("|");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
