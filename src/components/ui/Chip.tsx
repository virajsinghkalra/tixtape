import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

/** A quiet label pill (not interactive). */
export function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

type ChipButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean };

/** A tappable chip, e.g. a recent search. 44px tall for touch. */
export function ChipButton({
  selected = false,
  className,
  type = "button",
  ...rest
}: ChipButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected || undefined}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-chip border-2 px-4 text-sm font-semibold",
        "transition-transform duration-(--duration-fast) ease-spring active:scale-95",
        selected ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:border-ink",
        className,
      )}
      {...rest}
    />
  );
}
