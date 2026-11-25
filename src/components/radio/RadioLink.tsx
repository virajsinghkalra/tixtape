"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SILENCE, audio } from "../ListenHere";

/**
 * A link to Gig Radio. The click also unlocks sound on iPhone (it only allows audio started
 * inside a tap), so the radio page can autoplay once it opens.
 */
export function RadioLink({
  gig,
  className,
  children,
  onClick,
  "aria-label": ariaLabel,
}: {
  gig?: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  "aria-label"?: string;
}) {
  return (
    <Link
      href={gig ? `/radio?g=${encodeURIComponent(gig)}` : "/radio"}
      aria-label={ariaLabel}
      className={className}
      onClick={() => {
        const a = audio();
        a.src = SILENCE;
        void a.play().catch(() => {});
        onClick?.();
      }}
    >
      {children}
    </Link>
  );
}

/** The small "📻 Radio" pill used in headers. */
export function RadioPill({ gig, className }: { gig?: string; className?: string }) {
  return (
    <RadioLink
      gig={gig}
      className={`shrink-0 whitespace-nowrap rounded-chip border-2 border-night bg-night px-3 py-1 text-sm font-bold text-lime shadow-[2px_2px_0_0_var(--color-violet)] dark:border-line${className ? ` ${className}` : ""}`}
    >
      📻 Radio
    </RadioLink>
  );
}
