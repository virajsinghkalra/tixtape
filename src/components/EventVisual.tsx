"use client";

import type { VisualArtist } from "@/domain/visuals/visuals";
import { eventVisual, sizedImage } from "@/domain/visuals/visuals";
import { ArtistAvatar, TONE_VAR } from "./ArtistAvatar";
import { cx } from "./ui/cx";
import { useImageFallback } from "./ui/use-image-fallback";

type Props = {
  poster?: string | null;
  /** The lineup (any order, any size): the domain picks and orders the collage. */
  artists?: readonly VisualArtist[];
  /** The sticker on the fallback: a headliner or the title. */
  label: string;
  className?: string;
  /** The event hero (above the fold): eager, high fetch priority, hero-size images. */
  priority?: boolean;
};

/** Grid areas for 1–4 tiles: one fills, two split, three lead big, four tile. */
const LAYOUT: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2",
  4: "grid-cols-2 grid-rows-2",
};

/**
 * D-082/D-083: an event's picture, filling its (positioned) parent, as `eventVisual` decides:
 * the official poster, else a collage (photos first, designed fallbacks fill), else a branded
 * gradient with a sticker. Never an empty block.
 */
export function EventVisual({ poster, artists = [], label, className, priority = false }: Props) {
  const posterSrc = poster ? sizedImage(poster, priority ? "hero" : "card") : null;
  // D-084: a poster that fails to load falls back to the collage (or the branded fallback).
  const { failed, imgProps } = useImageFallback(posterSrc);
  const plan = eventVisual({ posterUrl: failed ? null : posterSrc, artists, label });
  const box = cx("absolute inset-0 overflow-hidden", className);
  if (plan.kind === "poster") {
    return (
      <div aria-hidden className={cx(box, "bg-night")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked poster, D-082 */}
        <img
          src={plan.url}
          alt=""
          {...imgProps}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      </div>
    );
  }
  if (plan.kind === "collage") {
    return (
      <div aria-hidden className={cx(box, "grid gap-0.5 bg-night", LAYOUT[plan.artists.length])}>
        {plan.artists.map((a) => (
          <div key={a.name} className="relative">
            <ArtistAvatar artist={a} size="fill" shape="square" priority={priority} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cx(box, "grid place-items-center p-4")}
      style={{
        background: `linear-gradient(135deg, ${TONE_VAR[plan.from]}, ${TONE_VAR[plan.to]})`,
      }}
    >
      <span className="max-w-full -rotate-6 rounded-chip border-2 border-night bg-lime px-4 py-2 text-center font-display text-2xl font-extrabold text-on-block uppercase shadow-[4px_5px_0_0_var(--color-night)] [overflow-wrap:anywhere]">
        {plan.label}
      </span>
    </div>
  );
}
