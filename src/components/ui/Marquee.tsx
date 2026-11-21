import type { ReactNode } from "react";
import { cx } from "./cx";
import { TONE_CLASS, type Tone } from "./tone";

type Props = {
  /** Rendered twice for a seamless loop; the copy is hidden from assistive tech. */
  items: ReactNode[];
  label: string;
  tone?: Tone;
  className?: string;
};

/** A ticker strip. Pauses on hover and stops under reduced motion. */
export function Marquee({ items, label, tone = "lime", className }: Props) {
  if (items.length === 0) return null;
  const repeat = Math.max(1, Math.ceil(8 / items.length));
  const row = Array.from({ length: repeat }, () => items).flat();
  return (
    <div
      role="region"
      aria-label={label}
      className={cx("marquee overflow-hidden py-3", TONE_CLASS[tone], className)}
    >
      <div className="marquee-track flex w-max">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            aria-hidden={copy === 1 || undefined}
            className="flex shrink-0 items-center"
          >
            {row.map((item, i) => (
              <li
                key={i}
                // Repeats are visual only; screen readers hear each item once.
                aria-hidden={i >= items.length || undefined}
                className="flex items-center gap-6 px-3 font-display text-xl font-extrabold whitespace-nowrap uppercase"
              >
                {item}
                <span aria-hidden>✦</span>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
