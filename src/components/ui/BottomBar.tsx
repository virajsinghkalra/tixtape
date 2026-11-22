import type { ReactNode } from "react";
import { cx } from "./cx";

/** A sticky action bar for phones (hidden from 640px up). The page keeps room for it. */
export function BottomBar({
  children,
  label,
  hidden = false,
}: {
  children: ReactNode;
  label: string;
  /** Slide away (e.g. while the same action is already on screen). */
  hidden?: boolean;
}) {
  return (
    <>
      <div aria-hidden className="h-20 sm:hidden" />
      <nav
        aria-label={label}
        data-bottom-bar
        aria-hidden={hidden || undefined}
        inert={hidden || undefined}
        className={cx(
          "fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden",
          "transition-transform duration-(--duration-base) ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          hidden && "translate-y-full duration-150 ease-[cubic-bezier(0.4,0,1,1)]",
        )}
      >
        <div className="flex items-center gap-3">{children}</div>
      </nav>
    </>
  );
}
