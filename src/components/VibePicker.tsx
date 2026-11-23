import Link from "next/link";
import type { CSSProperties } from "react";
import { cx } from "./ui/cx";
import { BLOCK_TONES, TONE_CLASS } from "./ui/tone";
import { vibeEmoji, type Vibe } from "./vibe-copy";

/** What each vibe tile is called and what it searches for (the search knows these words). */
const VIBE_TILES: Partial<Record<Vibe, { label: string; q: string }>> = {
  edm: { label: "EDM", q: "edm" },
  bollywood: { label: "Bollywood", q: "bollywood" },
  punjabi: { label: "Punjabi", q: "punjabi" },
  hiphop: { label: "Hip hop", q: "hip hop" },
  indie: { label: "Indie", q: "indie" },
  rock: { label: "Rock", q: "rock" },
  sufi: { label: "Sufi", q: "sufi" },
  pop: { label: "Pop", q: "pop" },
  kpop: { label: "K-pop", q: "kpop" },
  fusion: { label: "Fusion", q: "fusion" },
  festival: { label: "Festivals", q: "festival" },
};

/**
 * "Pick your vibe": loud, tappable genre tiles that open those shows (user: "interactive,
 * explore, Gen Z"). Only vibes with at least one upcoming show, most shows first.
 */
export function VibePicker({ vibes }: { vibes: Vibe[] }) {
  const tiles = vibes.flatMap((v) => {
    const t = VIBE_TILES[v];
    return t ? [{ vibe: v, ...t }] : [];
  });
  if (tiles.length < 2) return null;
  return (
    <section aria-labelledby="vibes-title" className="reveal mx-auto mt-10 max-w-6xl px-4 sm:px-6">
      <h2 id="vibes-title" className="font-display text-big font-extrabold tracking-tight">
        Pick your vibe
      </h2>
      <ul className="no-scrollbar -mx-4 mt-4 flex snap-x gap-3 overflow-x-auto px-4 pt-1 pb-3 sm:-mx-6 sm:px-6">
        {tiles.map((t, i) => (
          <li
            key={t.vibe}
            className="pop-in shrink-0 snap-start"
            style={{ "--i": i } as CSSProperties}
          >
            <Link
              href={`/search?q=${encodeURIComponent(t.q)}`}
              style={{ rotate: `${((i % 3) - 1) * 2}deg` } as CSSProperties}
              className={cx(
                "vibe-tile flex h-28 w-28 flex-col justify-between rounded-tile border-2 border-night p-3 shadow-[3px_4px_0_0_var(--color-night)] dark:border-line",
                TONE_CLASS[BLOCK_TONES[i % BLOCK_TONES.length]!],
              )}
            >
              <span aria-hidden className="vibe-emoji text-4xl leading-none">
                {vibeEmoji(t.vibe)}
              </span>
              <span className="font-display text-lg leading-none font-extrabold">{t.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
