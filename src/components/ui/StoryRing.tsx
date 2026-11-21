import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { TONE_CLASS, type BlockTone } from "./tone";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  /** Big text inside the circle, e.g. "12" for a date or initials. */
  face: string;
  /** Small text under the face, e.g. "DEC". */
  subface?: string;
  tone: BlockTone;
  seen?: boolean;
};

/** An Instagram-like story ring: a gradient ring around a colour face, label underneath. */
export function StoryRing({
  label,
  face,
  subface,
  tone,
  seen = false,
  className,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cx(
        "group flex w-20 shrink-0 flex-col items-center gap-2 rounded-card p-1 text-center",
        className,
      )}
      {...rest}
    >
      <span className="relative grid size-[4.5rem] place-items-center">
        <span
          aria-hidden
          className={cx(
            "absolute inset-0 rounded-full",
            seen
              ? "bg-line"
              : "ring-spin bg-[conic-gradient(var(--color-lime),var(--color-pink),var(--color-violet),var(--color-orange),var(--color-lime))]",
          )}
        />
        <span
          className={cx(
            "relative grid size-16 place-items-center rounded-full border-[3px] border-bg leading-none",
            "transition-transform duration-(--duration-base) ease-spring group-hover:scale-105 group-active:scale-95",
            TONE_CLASS[tone],
          )}
        >
          <span className="flex flex-col items-center">
            <span className="font-display text-xl font-extrabold">{face}</span>
            {subface && <span className="text-[0.625rem] font-bold uppercase">{subface}</span>}
          </span>
        </span>
      </span>
      <span className="line-clamp-2 w-full text-xs leading-tight font-semibold text-ink">
        {label}
      </span>
    </button>
  );
}
