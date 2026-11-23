import { tagline, vibeTag, type Vibe } from "./vibe-copy";
import { cx } from "./ui/cx";

/**
 * The show's genre as a chip ("⚡ EDM") with, for a solo show, its tagline beside it as a
 * separate line of text. Never glued onto the artist's name (user feedback, 23 Nov).
 */
export function VibeChip({
  vibe,
  seed,
  solo,
  size = "sm",
  className,
}: {
  vibe: Vibe;
  seed: string;
  solo: boolean;
  size?: "sm" | "lg";
  className?: string;
}) {
  const tag = vibeTag(vibe);
  const line = solo ? tagline(vibe, seed) : null;
  if (!tag && !line) return null;
  const lg = size === "lg";
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {tag && (
        <span
          className={cx(
            "inline-flex items-center gap-1 rounded-chip border-2 border-night bg-surface-2 font-bold whitespace-nowrap dark:border-line",
            lg ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
          )}
        >
          <span aria-hidden>{tag.emoji}</span> {tag.label}
        </span>
      )}
      {line && (
        <span className={cx("font-semibold text-muted", lg ? "text-lg" : "text-xs")}>{line}</span>
      )}
    </div>
  );
}
