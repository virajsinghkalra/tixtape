import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import { TONE_CLASS, type Tone } from "./tone";

type Props = HTMLAttributes<HTMLDivElement> & { tone?: Tone; padded?: boolean };

/** A bento tile: a loud colour block with the tile radius. Compose tiles in a CSS grid. */
export function Tile({ tone = "surface", padded = true, className, ...rest }: Props) {
  return (
    <div
      className={cx(
        "relative overflow-hidden rounded-tile",
        tone === "surface" && "border border-line",
        TONE_CLASS[tone],
        padded && "p-5 sm:p-7",
        className,
      )}
      {...rest}
    />
  );
}
