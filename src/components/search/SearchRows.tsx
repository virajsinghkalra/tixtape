"use client";

import { memo, useEffect, useRef, type ReactNode } from "react";
import { ArtistAvatar } from "../ArtistAvatar";
import { formatDateRange } from "../event-format";
import { cx } from "../ui/cx";
import { highlightMatch } from "./highlight";
import { reasonLabel, upcomingLabel, type SearchOption } from "./search-view";

type Props = {
  id: string;
  index: number;
  option: SearchOption;
  query: string;
  active: boolean;
  /** Stable callbacks taking the row's index, so unchanged rows skip re-rendering. */
  onHover: (index: number) => void;
  onChoose: (index: number) => void;
};

/** One listbox option: an artist, a city, an event or a recent query. Memoized (D-057). */
export const SearchRow = memo(function SearchRow({
  id,
  index,
  option,
  query,
  active,
  onHover,
  onChoose,
}: Props) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const { icon, title, detail } = describe(option, query, active);
  const face = faceOf(option);

  return (
    <li
      ref={ref}
      id={id}
      role="option"
      aria-selected={active}
      // Keep focus in the input so the list stays open while pressing.
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => onHover(index)}
      onClick={() => onChoose(index)}
      className={cx(
        "mx-2 flex min-h-14 cursor-pointer items-center gap-3 rounded-field px-3 py-2.5 transition-colors",
        active ? "bg-lime text-on-block" : "text-ink hover:bg-surface-2",
      )}
    >
      {face ?? (
        <span
          aria-hidden
          className={cx(
            "grid size-10 shrink-0 place-items-center rounded-full text-lg",
            active ? "bg-night/10" : "bg-surface-2",
          )}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {detail && (
          <span className={cx("block truncate text-sm", active ? "text-on-block" : "text-muted")}>
            {detail}
          </span>
        )}
      </span>
      <span aria-hidden className={cx("shrink-0 text-lg font-bold", active ? "" : "opacity-0")}>
        →
      </span>
    </li>
  );
});

/**
 * UX #11 faces: an artist's photo (else their designed fallback, D-083); an event pictured by
 * its matched artist or its title. Decorative: the name is in the row text.
 */
function faceOf(o: SearchOption): ReactNode {
  if (o.kind === "artist") {
    return (
      <ArtistAvatar
        artist={{ name: o.artist.name, imageUrl: o.artist.imageUrl ?? null }}
        size="sm"
      />
    );
  }
  if (o.kind === "event") {
    return (
      <ArtistAvatar
        artist={{ name: o.event.matchedArtist ?? o.event.title, imageUrl: null }}
        size="sm"
        shape="rounded"
      />
    );
  }
  return null;
}

function describe(
  o: SearchOption,
  query: string,
  active: boolean,
): { icon: string; title: ReactNode; detail: string | null } {
  switch (o.kind) {
    case "artist":
      return {
        icon: "🎤",
        title: (
          <Highlighted text={o.artist.name} match={o.artist.matchedText || query} active={active} />
        ),
        detail: `Artist · ${upcomingLabel(o.artist.upcomingCount)}`,
      };
    case "city":
      return {
        icon: "📍",
        title: <Highlighted text={o.city.city} match={query} active={active} />,
        detail: `City · ${upcomingLabel(o.city.upcomingCount)}`,
      };
    case "query":
      return {
        icon: "🕘",
        title: <Highlighted text={o.query} match={query} active={active} />,
        detail: "Recent search",
      };
    case "event": {
      const e = o.event;
      const when = formatDateRange(new Date(e.startsAt), null);
      const why = reasonLabel(e);
      const artistLed = e.matchReason === "artist" && e.matchedArtist;
      return {
        icon: e.type === "festival" ? "🎪" : "🎟️",
        title: artistLed ? (
          <>
            <Highlighted text={e.matchedArtist!} match={e.matchedText} active={active} /> plays here
          </>
        ) : (
          <Highlighted text={e.title} match={e.matchedText || query} active={active} />
        ),
        detail: [artistLed ? e.title : why, e.city, when].filter(Boolean).join(" · "),
      };
    }
  }
}

function Highlighted({ text, match, active }: { text: string; match: string; active: boolean }) {
  return (
    <>
      {highlightMatch(text, match).map((seg, i) =>
        seg.match ? (
          <mark
            key={i}
            className={cx("rounded-sm px-0.5 text-on-block", active ? "bg-white" : "bg-pink")}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
