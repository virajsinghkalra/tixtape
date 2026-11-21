import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";

/** A chip that navigates (filters, entity shortcuts). 44px tall for touch. */
export function ChipLink({
  href,
  children,
  selected = false,
}: {
  href: string;
  children: ReactNode;
  selected?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-chip border-2 px-4 text-sm font-semibold",
        "transition-transform duration-(--duration-fast) ease-spring active:scale-95",
        selected ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink hover:border-ink",
      )}
    >
      {children}
    </Link>
  );
}
