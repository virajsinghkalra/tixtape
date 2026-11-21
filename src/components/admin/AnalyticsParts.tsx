import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/** D-090: small server-rendered building blocks for /admin/analytics. No chart library. */

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex min-h-24 flex-col justify-between rounded-card border-2 border-line p-4">
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="font-display text-3xl font-extrabold tabular-nums">
        {value.toLocaleString("en-IN")}
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

/** Active devices per day as a line with a soft area; the last day is marked. */
export function Sparkline({ points }: { points: { day: string; devices: number }[] }) {
  const W = 300;
  const H = 64;
  const max = Math.max(1, ...points.map((p) => p.devices));
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const xy = points.map((p, i) => [i * step, H - 4 - (p.devices / max) * (H - 8)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = xy.at(-1);
  const first = points[0]?.day ?? "";
  const end = points.at(-1);
  return (
    <figure className="rounded-card border-2 border-line p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full text-violet"
        role="img"
        aria-label={`Active devices per day, ${first} to ${end?.day ?? ""}; peak ${max}`}
      >
        <path d={`${line}L${W},${H}L0,${H}Z`} fill="currentColor" opacity="0.15" />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {last && <circle cx={last[0]} cy={last[1]} r="3" fill="currentColor" />}
      </svg>
      <figcaption className="mt-2 flex justify-between text-xs text-muted tabular-nums">
        <span>{first.slice(5)}</span>
        <span>
          peak {max} · today {end?.devices ?? 0}
        </span>
      </figcaption>
    </figure>
  );
}

export type BarRow = { key: string; label: ReactNode; value: number; note?: string };

/** A ranked list with proportional bars (mobile-friendly: label above the bar). */
export function BarList({
  rows,
  empty = "Nothing yet",
  tone = "bg-violet",
}: {
  rows: BarRow[];
  empty?: string;
  tone?: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold">{r.label}</span>
            <span className="shrink-0 text-muted tabular-nums">
              {r.value.toLocaleString("en-IN")}
              {r.note ? ` · ${r.note}` : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-chip bg-surface-2">
            <div
              className={cx("h-full rounded-chip", tone)}
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
