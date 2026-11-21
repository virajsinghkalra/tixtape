import type { CSSProperties } from "react";
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

const NAME: Record<"huge" | "big" | "small", string> = {
  huge: "text-4xl",
  big: "text-2xl",
  small: "text-xl",
};

const FACE: Record<"huge" | "big" | "small", string> = {
  huge: "size-20",
  big: "size-11",
  small: "size-9",
};

/** Turns a planned story into slides for `StoryViewer`. Works on the server and the client. */
export function renderStory(eventId: string, plan: StoryPlan): Story[] {
  const tones = toneSequence(eventId, plan.slides.length);
  return plan.slides.map((slide, i) => ({
    id: slide.id,
    label: slide.label,
    tone: tones[i]!,
    dark: slide.kind === "solo" && Boolean(slide.artist.imageUrl),
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
              slide.artist.imageUrl && "text-white",
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
          <ul className="space-y-3">
            {slide.artists.map((a) => (
              <li key={a.name} className="flex items-center gap-3">
                {slide.faces && <Face artist={a} size={FACE[slide.size]} />}
                <span
                  className={cx(
                    "font-display leading-none font-extrabold uppercase [overflow-wrap:anywhere]",
                    NAME[slide.size],
                  )}
                >
                  {a.name}
                </span>
              </li>
            ))}
          </ul>
          {slide.more && <p className="text-base font-bold">{slide.more}</p>}
        </div>
      );
    case "playlist":
      return (
        <div className="flex flex-1 flex-col justify-center gap-4">
          {slide.face && <BigFace artist={slide.face} />}
          <Sticker tone="night" size="md" emoji="🎧" className="self-start">
            The playlist
          </Sticker>
          <p className="font-display text-big leading-tight font-extrabold">{slide.headline}</p>
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
 * Full-bleed artist photo under a dark fade, so the slide is never an empty block. Without a
 * photo, the name itself fills the space as giant type.
 */
export function ArtistBackdrop({ artist }: { artist: Pick<StoryArtist, "name" | "imageUrl"> }) {
  if (artist.imageUrl) {
    return (
      <div aria-hidden className="absolute inset-0 z-0">
        <div
          className="absolute inset-0 bg-cover bg-[center_10%]"
          style={{ backgroundImage: `url("${artist.imageUrl}")` } as CSSProperties}
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgb(11_11_15/0.92)_0%,rgb(11_11_15/0.55)_45%,rgb(11_11_15/0.15)_100%)]" />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 flex -rotate-6 flex-col justify-center overflow-hidden opacity-15"
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="font-display text-[clamp(4rem,18vw,9rem)] leading-[0.85] font-extrabold whitespace-nowrap uppercase"
        >
          {artist.name} {artist.name}
        </span>
      ))}
    </div>
  );
}

/** The solo artist, big and round, tilted like a sticker. */
function BigFace({ artist }: { artist: StoryArtist }) {
  return (
    <span
      aria-hidden
      className="grid size-40 -rotate-3 place-items-center self-start rounded-full border-4 border-night bg-night bg-cover bg-[center_10%] shadow-[5px_6px_0_0_var(--color-night)] sm:size-48"
      style={artist.imageUrl ? { backgroundImage: `url("${artist.imageUrl}")` } : undefined}
    >
      {!artist.imageUrl && (
        <span className="font-display text-7xl font-extrabold text-lime">
          {artist.name.charAt(0)}
        </span>
      )}
    </span>
  );
}

function Face({ artist, size = "size-14" }: { artist: StoryArtist; size?: string }) {
  if (!artist.imageUrl) {
    return (
      <span
        aria-hidden
        className={cx(
          "grid shrink-0 place-items-center rounded-full border-2 border-night bg-surface font-display text-lg font-extrabold text-ink",
          size,
        )}
      >
        {artist.name.charAt(0)}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cx("shrink-0 rounded-full border-2 border-night bg-cover bg-[center_10%]", size)}
      style={{ backgroundImage: `url("${artist.imageUrl}")` }}
    />
  );
}

/** D-082: the official poster (og:image, hotlinked), tilted like a flyer. */
function Poster({ url }: { url: string }) {
  return (
    <span
      aria-hidden
      className="block aspect-[4/3] w-full max-w-xs -rotate-2 self-start overflow-hidden rounded-card border-[3px] border-night bg-night shadow-[4px_5px_0_0_var(--color-night)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked poster, D-082 */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        className="size-full object-cover"
      />
    </span>
  );
}

/** Headliner photos stacked like stickers on a laptop lid. */
function FaceStack({ artists }: { artists: StoryArtist[] }) {
  return (
    <div aria-hidden className="flex pt-2 pl-3">
      {artists.map((a, i) => (
        <span
          key={a.name}
          className="-ml-4 size-24 rounded-full border-[3px] border-night bg-night bg-cover bg-[center_10%] shadow-[3px_4px_0_0_var(--color-night)] first:ml-0 sm:size-28"
          style={{
            backgroundImage: `url("${a.imageUrl}")`,
            rotate: `${(i % 2 === 0 ? -1 : 1) * (4 + i)}deg`,
            zIndex: artists.length - i,
          }}
        />
      ))}
    </div>
  );
}
