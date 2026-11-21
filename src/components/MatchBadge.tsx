import type { MatchStatus } from "@/domain/shared/lineup";
import { MATCH_STATE, type MatchTone } from "./lineup-view";

const DOT: Record<MatchTone, string> = {
  matched: "bg-matched shadow-[0_0_8px_var(--matched)]",
  pending: "border-[1.5px] border-pending motion-safe:animate-pulse",
  review: "bg-review",
  missing:
    "border-[1.5px] border-missing bg-[linear-gradient(135deg,transparent_45%,var(--missing)_45%,var(--missing)_55%,transparent_55%)]",
};

/**
 * A small coloured dot for an artist's Spotify match state (admin only: D-082 keeps match
 * commentary off public pages). Screen readers hear it only when it adds something.
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
