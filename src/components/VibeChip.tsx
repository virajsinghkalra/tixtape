import Link from "next/link";
import { tagline, vibeHref, vibeTag, type Vibe } from "./vibe-copy";
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
  link = false,
}: {
  vibe: Vibe;
  seed: string;
  solo: boolean;
  size?: "sm" | "lg";
  className?: string;
  /** The chip opens every show with this vibe (never inside another link, e.g. a card). */
  link?: boolean;
}) {
  const tag = vibeTag(vibe);
  const line = solo ? tagline(vibe, seed) : null;
  if (!tag && !line) return null;
  const lg = size === "lg";
  const href = vibeHref(vibe);
  const chip = cx(
    "inline-flex items-center gap-1 rounded-chip border-2 border-night bg-surface-2 font-bold whitespace-nowrap dark:border-line",
    lg ? "min-h-9 px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
    link && "min-h-8",
  );
  return (
    <div className={cx("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {tag &&
        (link && href ? (
          <Link
            href={href}
            className={cx(chip, "transition-transform active:scale-95 hover:-translate-y-0.5")}
          >
            <span aria-hidden>{tag.emoji}</span> {tag.label} <span aria-hidden>→</span>
          </Link>
        ) : (
          <span className={chip}>
            <span aria-hidden>{tag.emoji}</span> {tag.label}
          </span>
        ))}
      {line && (
        <span className={cx("font-semibold text-muted", lg ? "text-lg" : "text-xs")}>{line}</span>
      )}
    </div>
  );
}
