"use client";

import Link from "next/link";
import { RadioLink } from "../radio/RadioLink";
import { useEffect, useId, useRef, useState } from "react";

const LINKS = [
  { href: "/radio", label: "📻 Gig Radio" },
  { href: "/ready", label: "🎧 Ready to play" },
  { href: "/week", label: "📅 This week" },
  { href: "/upcoming", label: "🔮 Upcoming" },
  { href: "/past", label: "🕰️ Past gigs" },
  { href: "/me/gigs", label: "♡ Saved" },
  { href: "/search", label: "🔍 Search" },
];

const ITEM =
  "flex min-h-11 items-center rounded-field px-3 text-sm font-semibold hover:bg-surface-2";

/** ☰ in the header: a small disclosure sheet. Esc or an outside tap closes it and returns focus. */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative z-30">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip border-2 border-night bg-surface text-lg shadow-[2px_3px_0_0_var(--color-night)] transition-transform duration-(--duration-fast) ease-spring active:scale-95"
      >
        <span aria-hidden>{open ? "✕" : "☰"}</span>
      </button>
      {open && (
        <nav
          id={id}
          aria-label="Menu"
          className="absolute top-full right-0 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-card border-2 border-night bg-surface p-2 text-ink shadow-[4px_6px_0_0_var(--color-night)]"
        >
          <ul>
            {LINKS.map((l) => (
              <li key={l.href}>
                {l.href === "/radio" ? (
                  <RadioLink onClick={() => setOpen(false)} className={ITEM}>
                    {l.label}
                  </RadioLink>
                ) : (
                  <Link href={l.href} onClick={() => setOpen(false)} className={ITEM}>
                    {l.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
