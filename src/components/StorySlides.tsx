import Link from "next/link";
import {
  artistVisual,
  hasPhoto,
  type AvatarSize,
  type VisualArtist,
} from "@/domain/visuals/visuals";
import { ArtistAvatar, ArtistChip, AvatarStack, TONE_VAR } from "./ArtistAvatar";
import { EventVisual } from "./EventVisual";
import { toneSequence } from "./event-color";
import type { TitleSize } from "./lineup-copy";
import type { SlidePlan, StoryArtist, StoryPlan } from "./story-plan";
import { ButtonLink } from "./ui/Button";
import { cx } from "./ui/cx";
import { Sticker } from "./ui/Sticker";
import type { Story } from "./ui/StoryViewer";

/** Sized for a portrait story card (~440px wide), never a full-width banner. */
const TITLE: Record<TitleSize, string> = {
  xl: "text-5xl",
  lg: "text-4xl",
  md: "text-3xl",
};

/** Name size follows the avatar size: headliners big, lower tiers smaller (D-083). */
const NAME: Record<AvatarSize, string> = {
  xl: "text-2xl font-display font-extrabold uppercase",
  lg: "text-xl font-display font-extrabold uppercase",
  md: "text-lg font-display font-bold",
  sm: "text-base",
  xs: "text-sm",
};

/** Turns a planned story into slides for `StoryViewer`. Works on the server and the client. */
export function renderStory(eventId: string, plan: StoryPlan): Story[] {
  const tones = toneSequence(eventId, plan.slides.length);
  return plan.slides.map((slide, i) => ({
    id: slide.id,
    label: slide.label,
    tone: tones[i]!,
    dark: slide.kind === "solo" && hasPhoto(slide.artist),
    content: <SlideContent slide={slide} />,
  }));
}

function SlideContent({ slide }: { slide: SlidePlan }) {
  switch (slide.kind) {
    case "solo":
      return (
        <>
          <ArtistBackdrop artist={slide.artist} />
          <div
            className={cx(
              "relative z-10 flex flex-1 flex-col justify-between gap-8",
              hasPhoto(slide.artist) && "text-white",
            )}
          >
            <Sticker tone="night" size="md" emoji={slide.badge.emoji} className="self-start">
              {slide.badge.label}
            </Sticker>
            <div className="space-y-3">
              <p className="text-base font-bold">
                {slide.city ? `📍 ${slide.city} · ` : ""}
                {slide.dateLine}
              </p>
              <p className="font-display text-5xl leading-none font-extrabold uppercase [overflow-wrap:anywhere]">
                {slide.artist.name}
              </p>
            </div>
          </div>
        </>
      );
    case "intro":
      return (
        <div className="flex flex-1 flex-col justify-center gap-8">
          {slide.poster ? (
            <Poster url={slide.poster} />
          ) : slide.faces.length > 0 ? (
            <FaceStack artists={slide.faces} />
          ) : (
            <Sticker tone="night" size="md" tilt={-4} emoji="🎪" className="self-start text-2xl">
              Lineup
            </Sticker>
          )}
          <div className="space-y-3">
            <Sticker tone="night" size="md" emoji={slide.badge.emoji} className="self-start">
              {slide.badge.label}
            </Sticker>
            <p className="text-base font-bold">
              {slide.city ? `📍 ${slide.city} · ` : ""}
              {slide.dateLine}
            </p>
            <p
              className={cx(
                "font-display leading-[0.95] font-extrabold text-balance [overflow-wrap:anywhere]",
                TITLE[slide.titleSize],
              )}
            >
              {slide.title}
            </p>
          </div>
        </div>
      );
    case "names":
      return (
        <div className="flex flex-1 flex-col justify-center gap-5">
          <Sticker tone="night" size="md" className="self-start">
            {slide.kicker}
          </Sticker>
          <ul
            className={cx("flex flex-wrap gap-2.5", slide.size === "xl" && "flex-col items-start")}
          >
            {slide.artists.map((a, i) => (
              <li key={a.name} className="max-w-full">
                <ArtistChip
                  artist={a}
                  size={slide.size}
                  index={i}
                  nameClassName={NAME[slide.size]}
                />
              </li>
            ))}
            {slide.more && (
              <li>
                <Link
                  href={slide.more.href}
                  aria-label={`${slide.more.count} more on the lineup`}
                  className="relative z-10 inline-block rounded-chip"
                >
                  <AvatarStack artists={slide.more.artists} more={slide.more.count} />
                </Link>
              </li>
            )}
          </ul>
        </div>
      );
    case "playlist":
      return (
        <div className="flex flex-1 flex-col justify-center gap-4">
          {slide.face && <BigFace artist={slide.face} />}
          <Sticker tone="night" size="md" emoji={slide.tag?.emoji ?? "🎧"} className="self-start">
            {slide.tag ? `${slide.tag.label} playlist` : "The playlist"}
          </Sticker>
          <div className="flex flex-col gap-1">
            <p className="font-display text-big leading-tight font-extrabold">{slide.headline}</p>
            {slide.tagline && <p className="text-lg font-semibold opacity-85">{slide.tagline}</p>}
          </div>
          <div className="relative z-10 mt-2 flex flex-wrap gap-3">
            <ButtonLink href={slide.cta.href} variant="night" size="lg">
              {slide.cta.text} <span aria-hidden>→</span>
            </ButtonLink>
            {slide.secondary && (
              <ButtonLink href={slide.secondary.href} variant="secondary" size="lg">
                {slide.secondary.text} <span aria-hidden>→</span>
              </ButtonLink>
            )}
          </div>
        </div>
      );
  }
}

/**
 * Full-bleed artist picture (D-083 `artistVisual`): the photo under a dark fade, or the artist's
 * designed gradient with their name as giant type. Never an empty block.
 */
export function ArtistBackdrop({ artist }: { artist: VisualArtist }) {
  const v = artistVisual(artist);
  if (v.kind === "photo") {
    return (
      <div
        aria-hidden
        title={v.credit ? `📷 ${v.credit}` : undefined}
        className="absolute inset-0 z-0"
      >
        <ArtistAvatar artist={artist} size="fill" shape="square" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.92)_0%,rgb(11_11_15/0.55)_45%,rgb(11_11_15/0.15)_100%)]" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      style={{
        background: `linear-gradient(${v.angle}deg, ${TONE_VAR[v.from]}, ${TONE_VAR[v.to]})`,
      }}
    >
      <div className="flex h-full -rotate-6 flex-col justify-center opacity-20">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="font-display text-[clamp(4rem,18vw,9rem)] leading-[0.85] font-extrabold whitespace-nowrap uppercase"
          >
            {artist.name} {artist.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The solo artist, big and round, tilted like a sticker. */
function BigFace({ artist }: { artist: StoryArtist }) {
  return (
    <ArtistAvatar
      artist={artist}
      size="xl"
      tilt={-3}
      className="size-40 self-start border-4 shadow-[5px_6px_0_0_var(--color-night)] sm:size-48"
    />
  );
}

/** D-082: the official poster (og:image, hotlinked), tilted like a flyer. */
function Poster({ url }: { url: string }) {
  return (
    <span
      aria-hidden
      className="relative block aspect-[4/3] w-full max-w-xs -rotate-2 self-start overflow-hidden rounded-card border-[3px] border-night bg-night shadow-[4px_5px_0_0_var(--color-night)]"
    >
      <EventVisual poster={url} label="" />
    </span>
  );
}

/** The lineup stacked like stickers on a laptop lid: photos first, designed fallbacks fill. */
function FaceStack({ artists }: { artists: StoryArtist[] }) {
  return (
    <div aria-hidden className="flex pt-2 pl-3">
      {artists.map((a, i) => (
        <ArtistAvatar
          key={a.name}
          artist={a}
          size="xl"
          tilt={(i % 2 === 0 ? -1 : 1) * (4 + i)}
          className="-ml-4 shadow-[3px_4px_0_0_var(--color-night)] first:ml-0"
          style={{ zIndex: artists.length - i }}
        />
      ))}
    </div>
  );
}
