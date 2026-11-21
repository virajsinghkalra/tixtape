import type { LineupArtist } from "@/application/ports/events";
import type { BillingTier } from "@/domain/shared/lineup";
import { EmptyState } from "./EmptyState";
import { shareText, tierLabel } from "./lineup-copy";
import { groupByTier, isMatched } from "./lineup-view";
import { spotifyArtistUrl } from "./links";
import { MatchBadge, MatchLegend } from "./MatchBadge";
import { ShareButton } from "./ShareButton";
import { Sticker } from "./ui/Sticker";
import type { Tone } from "./ui/tone";

type Props = {
  title: string;
  venueLine: string;
  lineup: LineupArtist[];
  /** Artist to spotlight, e.g. after picking them in search. */
  highlight?: string;
};

/** Billing decides size, like a real festival poster. */
const NAME_STYLE: Record<BillingTier, string> = {
  headliner: "text-huge text-white",
  sub: "text-big text-lime",
  mid: "text-2xl text-white",
  support: "text-xl text-[#c9c9d6]",
};
const TIER_TONE: Record<BillingTier, Tone> = {
  headliner: "pink",
  sub: "lime",
  mid: "sky",
  support: "orange",
};

/** The shareable lineup card: a night-black poster in both themes, with Spotify match dots. */
export function LineupPoster({ title, venueLine, lineup, highlight }: Props) {
  const spotlight = highlight?.trim().toLowerCase();
  const groups = groupByTier(lineup);
  const solo = lineup.length === 1 ? lineup[0]! : null;
  if (groups.length === 0) {
    return (
      <EmptyState emoji="🫣" title="Lineup coming soon">
        The organisers haven&apos;t announced the artists yet. We&apos;ll add them as soon as they
        do.
      </EmptyState>
    );
  }
  return (
    <section
      id="lineup"
      aria-labelledby="lineup-title"
      // theme-dark: the poster is always dark, so its tokens (muted, match colours) are too.
      className="theme-dark scroll-mt-24 rounded-tile border-2 border-night bg-night p-5 text-center text-ink shadow-[5px_6px_0_0_var(--color-violet)] sm:p-10"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="lineup-title" className="font-display text-big font-extrabold">
          The lineup
        </h2>
        <ShareButton
          title={title}
          text={shareText(
            title,
            groups.flatMap((g) => g.artists.map((a) => a.name)),
          )}
          variant="primary"
        />
      </div>
      <p className="mt-2 text-left text-sm text-muted">{venueLine}</p>
      <ol className="mt-8 space-y-10">
        {groups.map((g) => (
          <li key={g.tier} data-tier={g.tier}>
            <Sticker tone={TIER_TONE[g.tier]} size="md">
              {tierLabel(g.tier, g.artists.length)}
            </Sticker>
            {solo && <SoloPhoto name={solo.name} imageUrl={solo.imageUrl} />}
            <ul
              className={`mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 ${g.tier === "headliner" ? "flex-col items-center" : ""}`}
            >
              {g.artists.map((a) => (
                <li
                  key={a.artistId}
                  data-testid="lineup-artist"
                  id={spotlight === a.name.toLowerCase() ? "highlighted-artist" : undefined}
                  data-highlighted={spotlight === a.name.toLowerCase() || undefined}
                  className="scroll-mt-28 rounded-card px-2 font-display font-extrabold uppercase [overflow-wrap:anywhere] data-highlighted:bg-violet data-highlighted:shadow-[0_0_0_3px_var(--color-lime),0_0_40px_8px_var(--color-violet)] data-highlighted:motion-safe:animate-pulse"
                >
                  <ArtistName artist={a} tier={g.tier} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div className="mt-10 border-t border-line pt-5">
        <MatchLegend statuses={lineup.map((a) => a.matchStatus)} soloName={solo?.name} />
      </div>
    </section>
  );
}

/** A solo lineup shows the artist's face, big, instead of a one-line "poster". */
function SoloPhoto({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  return (
    <div
      aria-hidden
      className="mx-auto mt-6 grid size-44 place-items-center overflow-hidden rounded-full border-4 border-lime bg-violet bg-cover bg-center shadow-[0_0_60px_-10px_var(--color-violet)] sm:size-56"
      style={imageUrl ? { backgroundImage: `url("${imageUrl}")` } : undefined}
    >
      {!imageUrl && (
        <span className="font-display text-8xl font-extrabold text-white">{name.charAt(0)}</span>
      )}
    </div>
  );
}

function ArtistName({ artist: a, tier }: { artist: LineupArtist; tier: BillingTier }) {
  const name = (
    <span className="inline-flex items-start gap-1.5">
      <span>{a.name}</span>
      <span className="mt-[0.2em] inline-flex text-base leading-none">
        <MatchBadge status={a.matchStatus} />
      </span>
    </span>
  );
  if (a.spotifyId && isMatched(a.matchStatus)) {
    return (
      <a
        href={spotifyArtistUrl(a.spotifyId)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${a.name} on Spotify (opens in new tab)`}
        className={`${NAME_STYLE[tier]} inline-flex min-h-11 items-center decoration-lime decoration-4 underline-offset-4 hover:underline`}
      >
        {name}
      </a>
    );
  }
  return <span className={NAME_STYLE[tier]}>{name}</span>;
}
