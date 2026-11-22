"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SAVED, upcomingSaved } from "@/components/device/device-lists";
import { useDeviceList } from "@/components/device/use-device-list";

/** ♡ in the header: opens "Your gigs", with the count of upcoming saved shows (this device). */
export function SavedLink() {
  const { items, ready } = useDeviceList(SAVED);
  // Date only after mount, so server and first client render match.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const count = ready && now ? upcomingSaved(items, now).length : 0;
  return (
    <Link
      href="/me/gigs"
      aria-label={count > 0 ? `Saved, ${count}` : "Saved"}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-chip border-2 border-night bg-surface text-lg shadow-[2px_3px_0_0_var(--color-night)] transition-transform duration-(--duration-fast) ease-spring active:scale-95"
    >
      <span aria-hidden>♡</span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 grid min-w-5 place-items-center rounded-full border-2 border-night bg-pink px-1 text-[11px] leading-4 font-extrabold text-on-block"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
