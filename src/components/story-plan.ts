/**
 * Plans an event story (the home "story" and the event-page carousel) as data, so its shape is
 * tested for 1, 2, 3 and many artists. Fewer slides when there's less to say:
 *   solo     → hero (artist image) · playlist
 *   duo/trio → intro · the lineup · playlist
 *   festival → intro · headliners · also on the bill · hidden gems · playlist
 */
import type { BillingTier } from "@/domain/shared/lineup";
import {
  lineupShape,
  orderLine,
  plural,
  tierLabel,
  titleSize,
  whoLine,
  type TitleSize,
} from "./lineup-copy";
import { headline, showLine, type PlaylistPreview } from "./playlist-preview";
import { shortName } from "./story-title";

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
};

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
    })
  | (Common & {
      kind: "names";
      kicker: string;
      artists: StoryArtist[];
      size: "huge" | "big" | "small";
      footer?: string;
      /** Show each artist's photo (duo/trio). */
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
      who: whoLine(names),
      ...where,
    });
    if (shape === "duo" || shape === "trio") {
      slides.push({
        id: "lineup",
        label: "The lineup",
        kind: "names",
        kicker: "🔥 The lineup",
        artists,
        size: "big",
        faces: true,
      });
    } else if (shape === "festival") {
      slides.push(...festivalSlides(artists));
    }
  }

  slides.push(playlistSlide(input, artists, solo));
  const heading = solo
    ? `Your night with ${solo.name}, in ${plural(slides.length, "slide")}`
    : `Your ${shortName(input.title)} in ${plural(slides.length, "slide")}`;
  return { heading, slides };
}

function festivalSlides(artists: StoryArtist[]): SlidePlan[] {
  const of = (...tiers: BillingTier[]) => artists.filter((a) => tiers.includes(a.tier));
  const headliners = of("headliner");
  const middle = of("sub", "mid");
  const gems = of("support");
  const out: SlidePlan[] = [];
  if (headliners.length > 0) {
    const label = `The ${tierLabel("headliner", headliners.length).toLowerCase()}`;
    out.push({
      id: "headliners",
      label,
      kind: "names",
      kicker: `🔥 ${label}`,
      artists: headliners,
      size: "huge",
      faces: false,
    });
  }
  if (middle.length > 0) {
    out.push({
      id: "bill",
      label: "Also on the bill",
      kind: "names",
      kicker: "🎤 Also on the bill",
      artists: middle,
      size: "big",
      faces: false,
    });
  }
  if (gems.length > 0) {
    out.push({
      id: "gems",
      label: gems.length === 1 ? "A hidden gem" : "Hidden gems",
      kind: "names",
      kicker: gems.length === 1 ? "💎 A hidden gem" : "💎 Hidden gems",
      artists: gems,
      size: "small",
      footer: gems.length === 1 ? "Get there early for this one." : "Get there early for these.",
      faces: false,
    });
  }
  return out;
}

function playlistSlide(
  input: StoryInput,
  artists: StoryArtist[],
  solo: StoryArtist | null,
): SlidePlan {
  const p = input.preview;
  const tiers = new Set(artists.map((a) => a.tier)).size;
  const order = orderLine(artists.length, tiers);
  const show = p ? showLine(p) : "";
  const detail = solo
    ? show
      ? `One playlist, ${show}.`
      : "One playlist to know every song by the night."
    : [order, show ? `It ${show}.` : ""].filter(Boolean).join(" ") || "Every artist on the lineup.";
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
