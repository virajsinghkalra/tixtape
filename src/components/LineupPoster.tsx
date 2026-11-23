import type { LineupArtist } from "@/application/ports/events";
import type { BillingTier } from "@/domain/shared/lineup";
import type { CSSProperties } from "react";
import {
  artistVisual,
  lineupLayout,
  orderForVisuals,
  type AvatarSize,
} from "@/domain/visuals/visuals";
import { ArtistAvatar } from "./ArtistAvatar";
import { EmptyState } from "./EmptyState";
import { tierLabel } from "./lineup-copy";
import { groupByTier, isMatched, splitTail, type TierGroup } from "./lineup-view";
import { spotifyArtistUrl } from "./links";
import { Sticker } from "./ui/Sticker";
import type { Tone } from "./ui/tone";

type Props = {
  lineup: LineupArtist[];
  /** Artist to spotlight, e.g. after picking them in search. */
  highlight?: string;
};

/** Billing decides size, like a real festival poster. */
const NAME_STYLE: Record<BillingTier, string> = {
  headliner: "text-[clamp(1.5rem,6.4vw,4.5rem)] leading-[0.95] tracking-tight text-white",
  sub: "text-big text-lime",
  mid: "text-2xl text-white",
  support: "text-xl text-[#c9c9d6]",
};
/** Big lineups: mid-card and support become compact chips (small avatar + name), not poster type. */
const DENSE_NAME: Partial<Record<BillingTier, string>> = {
  mid: "text-base text-white",
  support: "text-sm text-[#c9c9d6]",
};
const TIER_TONE: Record<BillingTier, Tone> = {
  headliner: "pink",
  sub: "lime",
  mid: "sky",
  support: "orange",
};

/** The shareable lineup card: a night-black poster in both themes. Names only, no match notes. */
export function LineupPoster({ lineup, highlight }: Props) {
  const spotlight = highlight?.trim().toLowerCase();
  const groups = groupByTier(lineup);
  const solo = lineup.length === 1 ? lineup[0]! : null;
  const layout = lineupLayout(lineup.length);
  const bigLineup = layout.bucket === "medium" || layout.bucket === "large";
  // D-083: CC photos need attribution; credits come from data, never hardcoded.
  const credits = [
    ...new Set(
      lineup.flatMap((a) => {
        const v = artistVisual(a);
        return v.kind === "photo" && v.credit ? [v.credit] : [];
      }),
    ),
  ];
  const { shown, tail } = splitTail(groups);
  const tailHasSpotlight =
    !!spotlight && tail.some((g) => g.artists.some((a) => a.name.toLowerCase() === spotlight));
  const renderGroup = (g: TierGroup<LineupArtist>) => (
    <li key={g.tier} data-tier={g.tier}>
      <Sticker tone={TIER_TONE[g.tier]} size="md">
        {tierLabel(g.tier, g.artists.length)}
      </Sticker>
      {solo && (
        <ArtistAvatar
          artist={solo}
          size="xl"
          className="mx-auto mt-6 size-44 border-4 border-lime shadow-[0_0_60px_-10px_var(--color-violet)] sm:size-56"
        />
      )}
      <ul
        className={`mt-4 flex flex-wrap justify-center ${dense(g.tier, bigLineup) ? "gap-2" : "gap-x-4 gap-y-3"} ${g.tier === "headliner" ? "flex-col items-center" : ""}`}
      >
        {(solo ? g.artists : orderForVisuals(g.artists)).map((a, i) => (
          <li
            key={a.artistId}
            data-testid="lineup-artist"
            id={spotlight === a.name.toLowerCase() ? "highlighted-artist" : undefined}
            data-highlighted={spotlight === a.name.toLowerCase() || undefined}
            style={{ "--i": i } as CSSProperties}
            className="pop-in max-w-full scroll-mt-28 rounded-chip px-1 font-display font-extrabold uppercase [overflow-wrap:break-word] data-highlighted:bg-violet data-highlighted:shadow-[0_0_0_3px_var(--color-lime),0_0_40px_8px_var(--color-violet)] data-highlighted:motion-safe:animate-pulse"
          >
            <ArtistName
              artist={a}
              tier={g.tier}
              avatar={solo ? null : layout.size[g.tier]}
              dense={dense(g.tier, bigLineup)}
            />
          </li>
        ))}
      </ul>
    </li>
  );
  if (groups.length === 0) {
    return <EmptyState emoji="🫣" title="Lineup soon" />;
  }
  return (
    <section
      id="lineup"
      aria-labelledby="lineup-title"
      // theme-dark: the poster is always dark, so its tokens (muted, match colours) are too.
      className="theme-dark scroll-mt-24 rounded-tile border-2 border-night bg-night p-5 text-center text-ink shadow-[5px_6px_0_0_var(--color-violet)] sm:p-10"
    >
      <h2 id="lineup-title" className="text-left font-display text-big font-extrabold">
        The lineup
      </h2>
      <ol className="mt-8 space-y-10">{shown.map(renderGroup)}</ol>
      {tail.length > 0 && (
        <details open={tailHasSpotlight || undefined} className="group mt-10">
          <summary className="mx-auto flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-chip border-2 border-lime px-5 py-2 font-display font-extrabold text-lime uppercase marker:hidden focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-white [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show all</span>
            <span className="hidden group-open:inline">Show less</span>
            <span aria-hidden className="transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <ol className="mt-10 space-y-10">{tail.map(renderGroup)}</ol>
        </details>
      )}
      {credits.length > 0 && (
        <details className="mt-6 text-left text-[0.6875rem] text-muted">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 font-semibold">
            📷 Photo credits <span aria-hidden>▾</span>
          </summary>
          <p className="mt-1">{credits.join(" · ")}</p>
        </details>
      )}
    </section>
  );
}

function dense(tier: BillingTier, bigLineup: boolean): boolean {
  return bigLineup && DENSE_NAME[tier] !== undefined;
}

/** Avatar + name (D-083); a matched artist links to Spotify. The name carries the tier size. */
function ArtistName({
  artist: a,
  tier,
  avatar,
  dense = false,
}: {
  artist: LineupArtist;
  tier: BillingTier;
  avatar: AvatarSize | null;
  dense?: boolean;
}) {
  // Big avatars sit above the name, so huge headliner type keeps the full width.
  const look = dense
    ? `${DENSE_NAME[tier]} gap-2 text-left rounded-chip border border-white/25 py-0.5 pr-3 pl-0.5 leading-tight`
    : `${NAME_STYLE[tier]} ${avatar === "xl" ? "flex-col gap-2 text-center" : "gap-3 text-left"}`;
  const name = (
    <>
      {avatar && <ArtistAvatar artist={a} size={avatar} className="border-white/80" />}
      <span className="min-w-0 text-balance">{a.name}</span>
    </>
  );
  if (a.spotifyId && isMatched(a.matchStatus)) {
    return (
      <a
        href={spotifyArtistUrl(a.spotifyId)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${a.name} on Spotify (opens in new tab)`}
        className={`${look} inline-flex ${dense ? "min-h-9" : "min-h-11"} max-w-full items-center decoration-lime decoration-4 underline-offset-4 hover:underline`}
      >
        {name}
      </a>
    );
  }
  return <span className={`${look} inline-flex max-w-full items-center`}>{name}</span>;
}
