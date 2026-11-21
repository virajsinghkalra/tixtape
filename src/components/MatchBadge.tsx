import type { MatchStatus } from "@/domain/shared/lineup";
import { spotifyMatchLine } from "./lineup-copy";
import { MATCH_STATE, type MatchTone } from "./lineup-view";

const DOT: Record<MatchTone, string> = {
  matched: "bg-matched shadow-[0_0_8px_var(--matched)]",
  pending: "border-[1.5px] border-pending motion-safe:animate-pulse",
  review: "bg-review",
  missing:
    "border-[1.5px] border-missing bg-[linear-gradient(135deg,transparent_45%,var(--missing)_45%,var(--missing)_55%,transparent_55%)]",
};

/**
 * A small coloured dot for an artist's Spotify match state. Screen readers hear it only when it
 * adds something ("not on Spotify"): matched artists are links named "… on Spotify", and the
 * poster has one summary line for the rest.
 */
export function MatchBadge({ status }: { status: MatchStatus }) {
  const { tone, label } = MATCH_STATE[status];
  return (
    <span data-match={tone} title={label} className="inline-flex items-center">
      <span aria-hidden className={`inline-block size-2 rounded-full ${DOT[tone]}`} />
      {tone === "missing" && <span className="sr-only">({label})</span>}
    </span>
  );
}

const LEGEND_ORDER: MatchStatus[] = ["auto", "pending", "needs_review", "not_found"];

/** Explains the dots that appear on this lineup, and how many artists are already matched. */
export function MatchLegend({
  statuses,
  soloName,
}: {
  statuses: readonly MatchStatus[];
  /** A solo show reads "Bhuwin is on Spotify." rather than "1 of 1 found". */
  soloName?: string;
}) {
  const matched = statuses.filter((s) => MATCH_STATE[s].tone === "matched").length;
  if (soloName && statuses.length === 1) {
    return (
      <p className="font-mono text-[0.6875rem] tracking-widest text-muted uppercase">
        {spotifyMatchLine(matched, 1, soloName)}
      </p>
    );
  }
  const tones = new Set(statuses.map((s) => MATCH_STATE[s].tone));
  return (
    <div className="flex flex-col items-center gap-3 font-mono text-[0.6875rem] tracking-widest text-muted uppercase sm:flex-row sm:justify-between">
      <p>
        <span className="text-ink tabular-nums">{matched}</span> of{" "}
        <span className="tabular-nums">{statuses.length}</span> found on Spotify
      </p>
      <ul aria-hidden className="flex flex-wrap justify-center gap-x-4 gap-y-2">
        {LEGEND_ORDER.filter((s) => tones.has(MATCH_STATE[s].tone)).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`inline-block size-2 rounded-full ${DOT[MATCH_STATE[s].tone]}`}
            />
            {MATCH_STATE[s].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
