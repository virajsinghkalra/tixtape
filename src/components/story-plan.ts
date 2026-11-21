/**
 * Plans an event story ("The rundown": the home story and the event-page carousel) as data, so
 * its shape is tested for 1, 2, 3 and many artists. Copy never counts slides. Fewer slides when
 * there's less to say:
 *   solo     → hero (artist image) · playlist
 *   duo/trio → intro · the lineup · playlist
 *   festival → intro · headliners · also on the bill · hidden gems · playlist
 */
import type { BillingTier } from "@/domain/shared/lineup";
import {
  introLine,
  lineupShape,
  moreLine,
  orderLine,
  pendingLine,
  STORY_HEADER,
  STORY_KICKERS,
  titleSize,
  type TitleSize,
} from "./lineup-copy";
import { headline, previewPending, showLine, type PlaylistPreview } from "./playlist-preview";

export type StoryArtist = {
  name: string;
  imageUrl: string | null;
  tier: BillingTier;
  billingRank: number;
};

export type StoryInput = {
  id: string;
  title: string;
  dateLine: string;
  city: string | null;
  badge: { emoji: string; label: string };
  artists: StoryArtist[];
  preview: PlaylistPreview | null;
  /** Where "Get the playlist" goes: "#playlist" on the event page, the event page elsewhere. */
  playlistHref: string;
  /** The event page, when the story isn't already on it ("See the full lineup"). */
  eventHref: string | null;
  /** Show length in days (IST), for "34 acts. 2 days." */
  days: number;
  /** Artists matched on Spotify; none means "Playlist coming soon", never "0 songs". */
  matched?: number;
};

/** How many names a slide shows before "+ N more on the lineup" (a portrait card fits these). */
const SHOWN = { headliners: 4, bill: 6, gems: 6, faces: 5 } as const;

type Common = { id: string; label: string };
export type SlidePlan =
  | (Common & {
      kind: "solo";
      artist: StoryArtist;
      title: string;
      titleSize: TitleSize;
      dateLine: string;
      city: string | null;
      badge: StoryInput["badge"];
    })
  | (Common & {
      kind: "intro";
      title: string;
      titleSize: TitleSize;
      dateLine: string;
      city: string | null;
      badge: StoryInput["badge"];
      who: string;
      /** Up to 5 top-billed artists with photos, stacked like stickers. */
      faces: StoryArtist[];
    })
  | (Common & {
      kind: "names";
      kicker: string;
      artists: StoryArtist[];
      size: "huge" | "big" | "small";
      /** "+ 20 more on the lineup" when the tier doesn't fit. */
      more: string | null;
      /** Show round photos next to the names (when any artist here has one). */
      faces: boolean;
    })
  | (Common & {
      kind: "playlist";
      headline: string | null;
      /** Solo show: the artist's face leads the slide, so it's never an empty colour block. */
      face: StoryArtist | null;
      detail: string;
      cta: { href: string; text: string };
      secondary: { href: string; text: string } | null;
    });

export type StoryPlan = { heading: string; slides: SlidePlan[] };

export function planStory(input: StoryInput): StoryPlan {
  const artists = [...input.artists].sort((a, b) => a.billingRank - b.billingRank);
  const shape = lineupShape(artists.length);
  const names = artists.map((a) => a.name);
  const where = { dateLine: input.dateLine, city: input.city, badge: input.badge };
  const slides: SlidePlan[] = [];
  const solo = shape === "solo" ? artists[0]! : null;

  if (solo) {
    slides.push({
      id: "solo",
      label: solo.name,
      kind: "solo",
      artist: solo,
      title: input.title,
      titleSize: titleSize(input.title),
      ...where,
    });
  } else {
    slides.push({
      id: "intro",
      label: "When and where",
      kind: "intro",
      title: input.title,
      titleSize: titleSize(input.title),
      who: introLine(names, artists.length, input.days),
      faces: artists.filter((a) => a.imageUrl).slice(0, SHOWN.faces),
      ...where,
    });
    if (shape === "duo" || shape === "trio") {
      slides.push({
        id: "lineup",
        label: "The lineup",
        kind: "names",
        kicker: STORY_KICKERS.lineup,
        artists,
        size: "big",
        more: null,
        faces: true,
      });
    } else if (shape === "festival") {
      slides.push(...festivalSlides(artists));
    }
  }

  slides.push(playlistSlide(input, artists, solo));
  return { heading: STORY_HEADER, slides };
}

function festivalSlides(artists: StoryArtist[]): SlidePlan[] {
  const of = (...tiers: BillingTier[]) => artists.filter((a) => tiers.includes(a.tier));
  const groups: {
    id: string;
    label: string;
    kicker: string;
    artists: StoryArtist[];
    shown: number;
    size: "huge" | "big" | "small";
  }[] = [
    {
      id: "headliners",
      label: "Top of the bill",
      kicker: STORY_KICKERS.headliners,
      artists: of("headliner"),
      shown: SHOWN.headliners,
      size: "huge",
    },
    {
      id: "bill",
      label: "Don't sleep on",
      kicker: STORY_KICKERS.bill,
      artists: of("sub", "mid"),
      shown: SHOWN.bill,
      size: "big",
    },
  ];
  const gems = of("support");
  groups.push({
    id: "gems",
    label: "Catch these early",
    kicker: STORY_KICKERS.gems(gems.length),
    artists: gems,
    shown: SHOWN.gems,
    size: "small",
  });
  return groups
    .filter((g) => g.artists.length > 0)
    .map((g) => ({
      id: g.id,
      label: g.label,
      kind: "names" as const,
      kicker: g.kicker,
      artists: g.artists.slice(0, g.shown),
      size: g.size,
      more: moreLine(g.artists.length - g.shown),
      faces: g.artists.some((a) => a.imageUrl),
    }));
}

function playlistSlide(
  input: StoryInput,
  artists: StoryArtist[],
  solo: StoryArtist | null,
): SlidePlan {
  const pending = previewPending(input.preview, input.matched ?? artists.length, artists.length);
  const p = pending ? null : input.preview;
  const tiers = new Set(artists.map((a) => a.tier)).size;
  const order = orderLine(artists.length, tiers);
  const show = p ? showLine(p) : "";
  const detail = pending
    ? pendingLine(artists.map((a) => a.name))
    : solo
      ? show
        ? `One playlist, ${show}.`
        : "One playlist to know every song by the night."
      : [order, show ? `It ${show}.` : ""].filter(Boolean).join(" ") ||
        "Every artist on the lineup.";
  return {
    id: "playlist",
    label: "The playlist",
    kind: "playlist",
    headline: p ? headline(p, solo?.name) : solo ? `${solo.name}, all night.` : null,
    face: solo,
    detail,
    cta: { href: input.playlistHref, text: "Get the playlist" },
    // A one-artist "lineup" isn't worth a page of its own.
    secondary:
      input.eventHref && artists.length > 1
        ? { href: input.eventHref, text: "See the full lineup" }
        : null,
  };
}
