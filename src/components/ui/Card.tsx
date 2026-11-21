import type { HTMLAttributes } from "react";
import { cx } from "./cx";

/** A plain surface with the card radius and a hairline border. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("rounded-card border border-line bg-surface text-ink", className)}
      {...rest}
    />
  );
}
