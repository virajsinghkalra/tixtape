"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/artists", label: "Artists" },
  { href: "/admin/jobs", label: "Jobs" },
] as const;

/** True for the section the path is in ("/admin" only matches itself). */
export function isCurrentSection(pathname: string, href: string): boolean {
  return href === "/admin"
    ? pathname === "/admin"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {LINKS.map(({ href, label }) => {
          const current = isCurrentSection(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "inline-flex min-h-11 items-center rounded-chip border-2 px-4 text-sm font-semibold",
                  current
                    ? "border-ink bg-ink text-bg"
                    : "border-line bg-surface text-ink hover:border-ink",
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
