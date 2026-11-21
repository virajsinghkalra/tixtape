import type { ReactNode } from "react";

/** A sticky action bar for phones (hidden from 640px up). The page keeps room for it. */
export function BottomBar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <>
      <div aria-hidden className="h-20 sm:hidden" />
      <nav
        aria-label={label}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden"
      >
        <div className="flex items-center gap-3">{children}</div>
      </nav>
    </>
  );
}
