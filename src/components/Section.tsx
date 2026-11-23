import type { ReactNode } from "react";

type Props = {
  id: string;
  title: string;
  /** Short line under the heading. */
  blurb?: string;
  emoji?: string;
  aside?: ReactNode;
  children: ReactNode;
};

/** A home section: chunky heading, optional emoji and blurb. One <section> per heading. */
export function Section({ id, title, blurb, emoji, aside, children }: Props) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="reveal mx-auto mt-16 max-w-6xl px-4 sm:px-6"
    >
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 id={`${id}-title`} className="font-display text-big font-extrabold tracking-tight">
            {emoji && (
              <span aria-hidden className="mr-2">
                {emoji}
              </span>
            )}
            {title}
          </h2>
          {blurb && <p className="mt-1 text-muted">{blurb}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
