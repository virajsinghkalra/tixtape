import type { CSSProperties } from "react";
import {
  artistVisual,
  type AvatarSize,
  type VisualArtist,
  type VisualTone,
} from "@/domain/visuals/visuals";
import { cx } from "./ui/cx";

/** D-083: block tones as CSS colours (the domain only names them). */
export const TONE_VAR: Record<VisualTone, string> = {
  lime: "var(--color-lime)",
  pink: "var(--color-pink)",
  violet: "var(--color-violet)",
  orange: "var(--color-orange)",
  sky: "var(--color-sky)",
};

export type AvatarBox = AvatarSize | "fill";

const BOX: Record<AvatarBox, string> = {
  xs: "size-7 text-[0.625rem] border-[1.5px]",
  sm: "size-9 text-xs border-2",
  md: "size-12 text-base border-2",
  lg: "size-16 text-xl border-2",
  xl: "size-24 text-3xl border-[3px] sm:size-28",
  fill: "absolute inset-0 size-full text-5xl",
};

const SHAPE = {
  circle: "rounded-full",
  rounded: "rounded-card",
  square: "",
} as const;

type Props = {
  artist: VisualArtist;
  size?: AvatarBox;
  shape?: keyof typeof SHAPE;
  /** Sticker tilt in degrees. */
  tilt?: number;
  className?: string;
  style?: CSSProperties;
};

/**
 * The one way an artist is pictured (D-083): their photo (anchored near the top, so faces are
 * never cropped), else an alternate CC photo with its credit as a tooltip, else a designed
 * fallback: a per-artist gradient seeded from the name, chunky initials and a sound-wave motif.
 * Decorative: the artist's name is always printed next to it.
 */
export function ArtistAvatar({
  artist,
  size = "md",
  shape = "circle",
  tilt,
  className,
  style,
}: Props) {
  const v = artistVisual(artist);
  const box = cx(
    "relative isolate shrink-0 overflow-hidden",
    size !== "fill" && "border-night",
    BOX[size],
    SHAPE[shape],
    className,
  );
  const turn = tilt ? { rotate: `${tilt}deg` } : undefined;
  if (v.kind === "photo") {
    return (
      <span
        aria-hidden
        title={v.credit ? `📷 ${v.credit}` : undefined}
        className={cx(box, "block bg-night")}
        style={{ ...turn, ...style }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked artist photo (D-083) */}
        <img
          src={v.url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover object-[50%_10%]"
        />
      </span>
    );
  }
  const long = [...v.initials].length;
  return (
    <span
      aria-hidden
      className={cx(box, "grid place-items-center font-display leading-none font-extrabold")}
      style={{
        background: `linear-gradient(${v.angle}deg, ${TONE_VAR[v.from]}, ${TONE_VAR[v.to]})`,
        ...turn,
        ...style,
      }}
    >
      <span
        className="relative z-10 text-night [text-shadow:1px_1px_0_rgb(255_255_255/0.45)]"
        style={{
          fontSize: long <= 2 ? "1em" : long <= 3 ? "0.8em" : long <= 5 ? "0.62em" : "0.5em",
        }}
      >
        {v.initials}
      </span>
      {size !== "xs" && size !== "sm" && (
        <span className="absolute right-[14%] bottom-[14%] flex h-[16%] items-end gap-[6%] opacity-40">
          {[0.5, 1, 0.7].map((h, i) => (
            <span
              key={i}
              className="block w-[0.12em] rounded-full bg-night"
              style={{ height: `${h * 100}%` }}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/** Avatar + name in a sticker chip. `href` makes it a link. */
export function ArtistChip({
  artist,
  size = "sm",
  index = 0,
  className,
  nameClassName,
}: {
  artist: VisualArtist;
  size?: AvatarSize;
  index?: number;
  className?: string;
  nameClassName?: string;
}) {
  return (
    <span
      className={cx(
        "pop-in inline-flex max-w-full items-center gap-2 rounded-chip border-2 border-night bg-surface py-1 pr-4 pl-1 font-semibold text-ink shadow-[2px_3px_0_0_var(--color-night)]",
        className,
      )}
      style={{ "--i": index } as CSSProperties}
    >
      <ArtistAvatar artist={artist} size={size} />
      <span className={cx("min-w-0 [overflow-wrap:anywhere]", nameClassName)}>{artist.name}</span>
    </span>
  );
}

/** "+N": overlapping avatars of who's not shown, as one chip. */
export function AvatarStack({
  artists,
  more,
  size = "sm",
  className,
}: {
  /** The first few hidden artists (3 are drawn). */
  artists: readonly VisualArtist[];
  more: number;
  size?: AvatarSize;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 rounded-chip border-2 border-night bg-lime py-1 pr-4 pl-1 font-display font-extrabold text-on-block shadow-[2px_3px_0_0_var(--color-night)]",
        className,
      )}
    >
      <span className="flex">
        {artists.slice(0, 3).map((a, i) => (
          <ArtistAvatar
            key={a.name}
            artist={a}
            size={size}
            className={i > 0 ? "-ml-3" : undefined}
          />
        ))}
      </span>
      +{more}
    </span>
  );
}
