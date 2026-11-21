"use client";

import { useEffect, type ReactNode } from "react";
import { cx } from "./cx";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Accessible name of the close button, e.g. "Close search". */
  closeLabel: string;
  children: ReactNode;
  className?: string;
};

const PHONE = "(max-width: 639px)";

/**
 * On phones, `open` lifts the content into a full-screen sheet; on larger screens it stays
 * inline. The children are never re-mounted, so a focused input keeps focus and state.
 */
export function Sheet({ open, onClose, closeLabel, children, className }: Props) {
  useEffect(() => {
    if (!open || !window.matchMedia(PHONE).matches) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div
      className={cx(
        className,
        open &&
          "max-sm:fixed max-sm:inset-0 max-sm:z-50 max-sm:m-0 max-sm:overflow-y-auto max-sm:bg-bg max-sm:p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))]",
      )}
    >
      {open && (
        <div className="mb-3 flex justify-end sm:hidden">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-chip px-4 text-sm font-semibold text-ink hover:bg-surface-2"
          >
            {closeLabel}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
