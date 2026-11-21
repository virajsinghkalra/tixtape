/**
 * Plans an event story ("The rundown": the home story and the event-page carousel) as data, so
 * its shape is tested for 1, 2, 3 and many artists. D-082 minimal copy: a headline and at most
 * one short line per slide, no counts of songs or minutes, never counts slides:
 *   solo     → hero (artist image) · playlist
 *   duo/trio → intro · the lineup · playlist
 *   festival → intro · headliners · also on the bill · hidden gems · playlist
 */
import type { BillingTier } from "@/domain/shared/lineup";
import {
  lineupShape,
  moreLine,
  PLAYLIST_SOON,
  STORY_CTA,
  STORY_HEADER,
  STORY_KICKERS,
  titleSize,
  type TitleSize,
} from "./lineup-copy";

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
  /** D-082: the official poster (og:image), shown on the intro instead of the face stack. */
  poster?: string | null;
  /** Where "Open playlist" goes: "#playlist" on the event page, `/events/{id}#playlist` elsewhere. */
  playlistHref: string;
  /** The event page, when the story isn't already on it ("See event"). */
  eventHref: string | null;
  /** Artists matched on Spotify; none means "Playlist soon ⏳". Unknown counts as all. */
  matched?: number;
};

/** How many names a slide shows before "+ N more on the lineup" (a portrait card fits these). */
const SHOWN = { headliners: 4, bill: 6, gems: 6, faces: 5 } as const;

type Common = { id: string; label: string };
export type SlidePlan =
  | (Common & {
      kind: "solo";
      artist: StoryArtist;
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
      /** Up to 5 top-billed artists with photos, stacked like stickers. */
      faces: StoryArtist[];
      poster: string | null;
    })
  | (Common & {
      kind: "names";
      kicker: string;
      artists: StoryArtist[];
      size: "huge" | "big" | "small";
      /** "+ 20 more" when the tier doesn't fit. */
      more: string | null;
      /** Show round photos next to the names (when any artist here has one). */
      faces: boolean;
    })
  | (Common & {
      kind: "playlist";
      headline: string;
      /** Solo show: the artist's face leads the slide, so it's never an empty colour block. */
      face: StoryArtist | null;
      cta: { href: string; text: string };
      secondary: { href: string; text: string } | null;
    });

export type StoryPlan = { heading: string; slides: SlidePlan[] };

export function planStory(input: StoryInput): StoryPlan {
  const artists = [...input.artists].sort((a, b) => a.billingRank - b.billingRank);
  const shape = lineupShape(artists.length);
  const where = { dateLine: input.dateLine, city: input.city, badge: input.badge };
  const slides: SlidePlan[] = [];
  const solo = shape === "solo" ? artists[0]! : null;

  if (solo) {
    slides.push({
      id: "solo",
      label: solo.name,
      kind: "solo",
      artist: solo,
      ...where,
    });
  } else {
    slides.push({
      id: "intro",
      label: "When and where",
      kind: "intro",
      title: input.title,
      titleSize: titleSize(input.title),
      faces: artists.filter((a) => a.imageUrl).slice(0, SHOWN.faces),
      poster: input.poster ?? null,
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
  const pending = artists.length > 0 && (input.matched ?? artists.length) === 0;
  return {
    id: "playlist",
    label: "The playlist",
    kind: "playlist",
    headline: pending ? PLAYLIST_SOON : solo ? `${solo.name}, all night.` : STORY_CTA.headline,
    face: solo,
    cta: { href: input.playlistHref, text: STORY_CTA.playlist },
    secondary: input.eventHref ? { href: input.eventHref, text: STORY_CTA.event } : null,
  };
}
