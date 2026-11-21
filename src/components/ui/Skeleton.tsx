import { cx } from "./cx";

/** Shimmering placeholder. Decorative: pair it with a visible or sr-only loading message. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("skeleton rounded-field", className)} />;
}
