import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx";
import { TONE_CLASS, type Tone } from "./tone";

type Props = {
  children: ReactNode;
  /** Decorative emoji, hidden from screen readers. */
  emoji?: string;
  tone?: Tone;
  /** Degrees of tilt; stickers look slapped on. */
  tilt?: number;
  size?: "sm" | "md";
  className?: string;
};

/** A tilted badge with an optional emoji: "🔴 Tonight", "⏰ 21 days to go". */
export function Sticker({
  children,
  emoji,
  tone = "lime",
  tilt = -3,
  size = "sm",
  className,
}: Props) {
  return (
    <span
      style={{ "--tilt": `${tilt}deg`, rotate: `${tilt}deg` } as CSSProperties}
      className={cx(
        "sticker-wiggle inline-flex items-center gap-1.5 rounded-chip border-2 border-night font-bold whitespace-nowrap shadow-[2px_3px_0_0_var(--color-night)]",
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3.5 py-1 text-sm",
        TONE_CLASS[tone],
        className,
      )}
    >
      {emoji && <span aria-hidden>{emoji}</span>}
      {children}
    </span>
  );
}
