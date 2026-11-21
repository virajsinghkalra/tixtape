import type { CSSProperties } from "react";
import { visualFor } from "./event-visual";
import { cx } from "./ui/cx";

type Props = {
  poster?: string | null;
  /** Headliner photos in billing order (null where missing). */
  faces?: readonly (string | null | undefined)[];
  /** The sticker on the fallback: a headliner or the title. */
  label: string;
  className?: string;
};

/** Grid areas for 1–4 photos: one fills, two split, three lead big, four tile. */
const LAYOUT: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 grid-rows-2 [&>*:first-child]:row-span-2",
  4: "grid-cols-2 grid-rows-2",
};

/**
 * D-082: an event's picture, filling its (positioned) parent: the official poster, else a bold
 * collage of the headliners' Spotify photos, else a branded gradient with a sticker.
 * Plain lazy <img>/backgrounds: remote images are hotlinked, not optimised.
 */
export function EventVisual({ poster, faces = [], label, className }: Props) {
  const plan = visualFor(poster, faces, label);
  const box = cx("absolute inset-0 overflow-hidden", className);
  if (plan.kind === "poster") {
    return (
      <div aria-hidden className={cx(box, "bg-night")}>
        {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked poster, D-082 */}
        <img
          src={plan.url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      </div>
    );
  }
  if (plan.kind === "faces") {
    return (
      <div aria-hidden className={cx(box, "grid gap-0.5 bg-night", LAYOUT[plan.urls.length])}>
        {plan.urls.map((url) => (
          <div
            key={url}
            className="bg-cover bg-center"
            style={{ backgroundImage: `url("${url}")` } as CSSProperties}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className={cx(
        box,
        "grid place-items-center bg-[linear-gradient(135deg,var(--color-violet),var(--color-pink)_55%,var(--color-orange))] p-4",
      )}
    >
      <span className="max-w-full -rotate-6 rounded-chip border-2 border-night bg-lime px-4 py-2 text-center font-display text-2xl font-extrabold text-on-block uppercase shadow-[4px_5px_0_0_var(--color-night)] [overflow-wrap:anywhere]">
        {plan.label}
      </span>
    </div>
  );
}
