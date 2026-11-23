/**
 * Plans an event story ("The rundown": the home story and the event-page carousel) as data, so
 * its shape is tested for 1, 2, 3 and many artists. D-082 minimal copy: a headline and at most
 * one short line per slide, no counts of songs or minutes, never counts slides:
 *   solo     → hero (artist image) · playlist
 *   duo/trio → intro · the lineup · playlist
 *   festival → intro · headliners · also on the bill · hidden gems · playlist
 */
import { soloLine, vibeHeadline, type Vibe } from "./vibe-copy";
import type { BillingTier } from "@/domain/shared/lineup";
import {
  lineupLayout,
  orderForVisuals,
  type AvatarSize,
  type LineupLayout,
  type VisualArtist,
} from "@/domain/visuals/visuals";
import {
  lineupShape,
  PLAYLIST_SOON,
  STORY_CTA,
  STORY_HEADER,
  STORY_KICKERS,
  titleSize,
  type TitleSize,
} from "./lineup-copy";

/** D-083: any artist the visuals system can picture (photo, alt photo + credit, or fallback). */
export type StoryArtist = VisualArtist & { tier: BillingTier; billingRank: number };

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
  /** False when the show has no playlist (ready or cooking): the button says "Listen now". */
  playable?: boolean;
  /** The music's vibe, for the last slide's line (vibe-copy.ts). */
  vibe?: Vibe;
};

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
      /** Avatar chips, ordered by `orderForVisuals` (photos first within the tier). */
      artists: StoryArtist[];
      size: AvatarSize;
      /** Who didn't fit: drawn as one "+N" avatar-stack chip linking to the lineup. */
      more: { count: number; artists: StoryArtist[]; href: string } | null;
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
  const layout = lineupLayout(artists.length);

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
      faces: orderForVisuals(artists).slice(0, layout.faceStack),
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
        size: "lg",
        more: null,
      });
    } else if (shape === "festival") {
      slides.push(...festivalSlides(artists, layout, `${input.eventHref ?? ""}#lineup`));
    }
  }

  slides.push(playlistSlide(input, artists, solo));
  return { heading: STORY_HEADER, slides };
}

function festivalSlides(
  artists: StoryArtist[],
  layout: LineupLayout,
  lineupHref: string,
): SlidePlan[] {
  const of = (...tiers: BillingTier[]) =>
    orderForVisuals(artists.filter((a) => tiers.includes(a.tier)));
  const gems = of("support");
  const groups = [
    {
      id: "headliners",
      label: "Top of the bill",
      kicker: STORY_KICKERS.headliners,
      artists: of("headliner"),
      tier: "headliner" as const,
    },
    {
      id: "bill",
      label: "Don't sleep on",
      kicker: STORY_KICKERS.bill,
      artists: of("sub", "mid"),
      tier: "sub" as const,
    },
    {
      id: "gems",
      label: "Catch these early",
      kicker: STORY_KICKERS.gems(gems.length),
      artists: gems,
      tier: "support" as const,
    },
  ];
  return groups
    .filter((g) => g.artists.length > 0)
    .map((g) => {
      // Never "+1": one extra artist just shows.
      const cap = layout.perSlide[g.tier];
      const shown = g.artists.length === cap + 1 ? cap + 1 : cap;
      const hidden = g.artists.slice(shown);
      return {
        id: g.id,
        label: g.label,
        kind: "names" as const,
        kicker: g.kicker,
        artists: g.artists.slice(0, shown),
        size: layout.size[g.tier],
        more:
          hidden.length > 0
            ? { count: hidden.length, artists: hidden.slice(0, 3), href: lineupHref }
            : null,
      };
    });
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
    headline: pending
      ? PLAYLIST_SOON
      : solo
        ? `${soloLine(solo.name, input.vibe ?? "default", input.id)}.`
        : vibeHeadline(input.vibe ?? "festival", input.id),
    face: solo,
    cta: {
      href: input.playlistHref,
      text: pending || input.playable === false ? STORY_CTA.listen : STORY_CTA.playlist,
    },
    secondary: input.eventHref ? { href: input.eventHref, text: STORY_CTA.event } : null,
  };
}
