import { cx } from "./ui/cx";
import { TONE_CLASS, type BlockTone } from "./ui/tone";

const STEPS: { emoji: string; title: string; body: string; tone: BlockTone }[] = [
  { emoji: "🔍", title: "Search a gig", body: "A festival, an artist or your city.", tone: "lime" },
  { emoji: "🎤", title: "See the lineup", body: "Headliners first, like the poster.", tone: "sky" },
  {
    emoji: "🎧",
    title: "Open the playlist",
    body: "One shared playlist in Spotify. No login.",
    tone: "violet",
  },
];

/** A compact three-step strip: what the app does, in one glance. */
export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="mx-auto mt-12 max-w-6xl px-4 sm:px-6">
      <h2 id="how-title" className="mb-4 font-display text-big font-extrabold">
        How it works
      </h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className={cx("flex items-center gap-4 rounded-card p-4", TONE_CLASS[s.tone])}
          >
            <span
              aria-hidden
              className="grid size-12 shrink-0 place-items-center rounded-full border-2 border-night bg-surface text-2xl"
            >
              {s.emoji}
            </span>
            <span>
              <span className="block font-display text-lg font-extrabold">
                {i + 1}. {s.title}
              </span>
              <span className="block text-sm font-medium">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
