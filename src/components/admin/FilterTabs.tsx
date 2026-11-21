import Link from "next/link";
import { cx } from "@/components/ui/cx";

type Tab = { href: string; label: string; current: boolean };

/** Link tabs for list filters, so a filter is a shareable URL and works without JS. */
export function FilterTabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              aria-current={t.current ? "page" : undefined}
              className={cx(
                "inline-flex min-h-11 items-center rounded-chip border-2 px-4 text-sm font-semibold",
                t.current
                  ? "border-ink bg-ink text-bg"
                  : "border-line bg-surface text-ink hover:border-ink",
              )}
            >
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
