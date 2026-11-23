import { cx } from "./ui/cx";
import { TONE_CLASS, type BlockTone } from "./ui/tone";

/**
 * A different splash every time someone opens Tixtape (user, 24 Nov: "random each time, max
 * 1-2 s"). Pure CSS: it plays for ~1.4 s and fades, never blocks taps after that, and a tiny
 * inline script drops it on later page loads in the same visit. Playlist-first copy.
 */
const LINES = [
  ["Every gig.", "Its playlist."],
  ["Press play", "before the show."],
  ["Know every word", "before they do."],
  ["Your next gig,", "pre-played."],
  ["Setlists,", "served hot."],
  ["Learn the drops.", "Own the night."],
  ["Front row starts", "in your earphones."],
] as const;
const TONES: BlockTone[] = ["lime", "pink", "violet", "orange", "sky"];
const LOOKS = ["vinyl", "eq", "emoji"] as const;
const EMOJIS = ["🎧", "🎤", "⚡", "🥁", "🎸", "💜", "🔥"];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/**
 * Seen this visit already (a refresh or another page): hide it before first paint with a flag on
 * <html>. Never remove the node: React would put it back while hydrating (and replay it).
 */
const DROP_IF_SEEN = `try{var s=sessionStorage;if(s.getItem("tt.splash")){document.documentElement.dataset.splash="seen"}else{s.setItem("tt.splash","1")}}catch(e){}`;

export function Splash({ nonce }: { nonce?: string }) {
  const [a, b] = pick(LINES);
  const tone = pick(TONES);
  const look = pick(LOOKS);
  const emoji = pick(EMOJIS);
  return (
    <>
      <div
        id="tt-splash"
        aria-hidden
        className={cx(
          "splash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 px-8 text-center",
          TONE_CLASS[tone],
        )}
      >
        {look === "vinyl" && (
          <span className="splash-pop relative block size-36 rounded-full border-4 border-night bg-[repeating-radial-gradient(circle,#16161c_0_2px,#0b0b0f_2px_5px)] shadow-[6px_7px_0_0_var(--color-night)]">
            <span className="vinyl-disc absolute inset-0 rounded-full" />
            <span className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-night bg-lime text-xs font-extrabold text-on-block">
              tixtape
            </span>
          </span>
        )}
        {look === "eq" && (
          <span className="splash-pop flex h-24 items-end gap-2">
            {[0.9, 0.6, 1.1, 0.75, 1].map((d, i) => (
              <span
                key={i}
                className="splash-bar block w-4 rounded-full bg-night"
                style={{ animationDuration: `${d}s`, animationDelay: `${-i * 0.15}s` }}
              />
            ))}
          </span>
        )}
        {look === "emoji" && <span className="splash-bounce text-8xl leading-none">{emoji}</span>}
        <p className="splash-rise font-display text-5xl leading-[0.95] font-extrabold tracking-tight">
          {a}
          <br />
          {b}
        </p>
        <span className="splash-rise rounded-chip border-2 border-night bg-night px-4 py-1.5 text-lg font-extrabold text-lime [animation-delay:120ms]">
          tix<span className="text-white">tape</span>
        </span>
      </div>
      {/* Browsers hide a script's nonce from the DOM (it reads ""), so React would flag it. */}
      <script
        nonce={nonce}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: DROP_IF_SEEN }}
      />
    </>
  );
}
