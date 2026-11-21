"use client";

import { useEffect, useState } from "react";
import { cx } from "../ui/cx";

const BACK_ONLINE_MS = 2000;

/** D-084 (UX plan #14): "You're offline" while the connection is gone, then "Back online". */
export function NetworkBanner() {
  const [state, setState] = useState<"online" | "offline" | "back">("online");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const offline = () => {
      clearTimeout(timer);
      setState("offline");
    };
    const online = () => {
      setState((s) => (s === "offline" ? "back" : s));
      timer = setTimeout(() => setState("online"), BACK_ONLINE_MS);
    };
    if (!navigator.onLine) offline();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, []);

  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex justify-center px-4"
    >
      {state !== "online" && (
        <p
          className={cx(
            "slide-down rounded-chip border-2 border-night px-4 py-1.5 text-sm font-bold text-on-block shadow-[2px_3px_0_0_var(--color-night)]",
            state === "offline" ? "bg-orange" : "bg-lime",
          )}
        >
          <span aria-hidden>{state === "offline" ? "📴 " : "📶 "}</span>
          {state === "offline" ? "You're offline" : "Back online"}
        </p>
      )}
    </div>
  );
}
