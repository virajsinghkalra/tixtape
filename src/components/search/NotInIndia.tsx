"use client";

import { ArtistAvatar } from "../ArtistAvatar";
import { cx } from "../ui/cx";
import { COPY } from "../ux-copy";
import { WatchArtistButton } from "../WatchArtistButton";
import { worthLookingUp } from "./live-lookup";

type Props = {
  /** The lookup's canonical name when known, else the query exactly as typed (never lowercased). */
  name: string;
  imageUrl?: string | null;
  /** True while the live lookup is still checking. */
  checking?: boolean;
  compact?: boolean;
  /** Inside the type-ahead: keep focus in the search box. */
  keepFocus?: boolean;
};

/** The zero-result header (UX #7): "Not in India yet 🫠", the artist chip and "🔔 Ping me". */
export function NotInIndia({
  name,
  imageUrl = null,
  checking = false,
  compact = false,
  keepFocus,
}: Props) {
  const watchable = worthLookingUp(name);
  return (
    <div>
      <p className={cx("font-display font-extrabold", compact ? "text-xl" : "text-big")}>
        {COPY.notInIndia}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="inline-flex min-h-11 items-center gap-2 rounded-chip border-2 border-night bg-surface py-1 pr-4 pl-1 font-semibold text-ink dark:border-line">
          <ArtistAvatar
            artist={{ name, imageUrl }}
            size="sm"
            className={checking ? "motion-safe:animate-pulse" : undefined}
          />
          <span aria-hidden>🎤</span> {name}
        </span>
        {checking && (
          <span className="text-sm font-semibold text-muted motion-safe:animate-pulse">
            <span aria-hidden>📼 </span>
            {COPY.checking}
          </span>
        )}
        {watchable && <WatchArtistButton artist={name} keepFocus={keepFocus} />}
      </div>
    </div>
  );
}
