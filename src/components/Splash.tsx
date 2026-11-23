import type { CSSProperties } from "react";
import { cx } from "./ui/cx";
import { TONE_CLASS, type BlockTone } from "./ui/tone";

/**
 * A different splash every time someone opens Tixtape (user, 24 Nov: random each visit,
 * ~3.5 s, stylish and animated). Drifting colour blobs, floating emojis, words that pop in one by
 * one, then an iris wipe out at ~3.5 s. Pure CSS: it never blocks taps after it ends, a tap skips
 * it, a refresh in the same visit skips it, and reduced-motion users never see it.
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
const BLOBS: Record<BlockTone, [string, string]> = {
  lime: ["var(--color-sky)", "var(--color-pink)"],
  pink: ["var(--color-orange)", "var(--color-violet)"],
  violet: ["var(--color-pink)", "var(--color-sky)"],
  orange: ["var(--color-pink)", "var(--color-lime)"],
  sky: ["var(--color-lime)", "var(--color-violet)"],
};
const LOOKS = ["vinyl", "eq", "emoji"] as const;
const EMOJIS = ["🎧", "🎤", "⚡", "🥁", "🎸", "💜", "🔥", "🪩", "🎶"];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/**
 * Seen this visit already (a refresh or another page): hide it before first paint with a flag on
 * <html>. Never remove the node: React would put it back while hydrating (and replay it).
 */
const DROP_IF_SEEN = `try{var s=sessionStorage;if(s.getItem("tt.splash")){document.documentElement.dataset.splash="seen"}else{s.setItem("tt.splash","1")}}catch(e){}`;

export function Splash({ nonce }: { nonce?: string }) {
  const lines = pick(LINES);
  const tone = pick(TONES);
  const look = pick(LOOKS);
  const emoji = pick(EMOJIS);
  const [blobA, blobB] = BLOBS[tone];
  const floaters = Array.from({ length: 7 }, (_, i) => ({
    e: pick(EMOJIS),
    left: `${4 + i * 13 + Math.random() * 6}%`,
    delay: `${(Math.random() * 0.9).toFixed(2)}s`,
    size: `${1.4 + Math.random() * 1.4}rem`,
  }));
  let word = 0;
  return (
    <>
      <div
        id="tt-splash"
        aria-hidden
        className={cx(
          "splash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-7 overflow-hidden px-8 text-center",
          TONE_CLASS[tone],
        )}
      >
        <span
          className="splash-blob absolute -top-24 -left-24 size-80 rounded-full opacity-70 blur-3xl"
          style={{ background: blobA }}
        />
        <span
          className="splash-blob splash-blob-b absolute -right-28 -bottom-28 size-96 rounded-full opacity-60 blur-3xl"
          style={{ background: blobB }}
        />
        {floaters.map((f, i) => (
          <span
            key={i}
            className="splash-float absolute bottom-[-3rem]"
            style={{ left: f.left, animationDelay: f.delay, fontSize: f.size } as CSSProperties}
          >
            {f.e}
          </span>
        ))}
        <div className="relative">
          {look === "vinyl" && (
            <span className="splash-pop relative block size-40">
              <span className="vinyl-disc absolute inset-0 rounded-full border-4 border-night bg-[repeating-radial-gradient(circle,#1b1b22_0_2px,#0b0b0f_2px_5px)] shadow-[7px_8px_0_0_var(--color-night)]" />
              <span className="absolute top-1/2 left-1/2 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-4 border-night bg-lime text-2xl">
                {emoji}
              </span>
              <span className="splash-arm absolute -top-3 -right-5 h-24 w-2.5 origin-top rounded-full bg-night" />
            </span>
          )}
          {look === "eq" && (
            <span className="splash-pop flex h-28 items-end gap-2.5">
              {[0.9, 0.6, 1.1, 0.75, 1, 0.65, 0.95].map((d, i) => (
                <span
                  key={i}
                  className="splash-bar block w-4 rounded-full bg-night"
                  style={{ animationDuration: `${d}s`, animationDelay: `${-i * 0.13}s` }}
                />
              ))}
            </span>
          )}
          {look === "emoji" && (
            <span className="splash-bounce block text-9xl leading-none">{emoji}</span>
          )}
        </div>
        <p className="relative font-display text-5xl leading-[0.95] font-extrabold tracking-tight">
          {lines.map((line, l) => (
            <span key={l} className="block">
              {line.split(" ").map((w) => {
                const i = word++;
                return (
                  <span
                    key={`${w}-${i}`}
                    className="splash-word mx-[0.12em] inline-block"
                    style={{ animationDelay: `${(0.25 + i * 0.09).toFixed(2)}s` }}
                  >
                    {w}
                  </span>
                );
              })}
            </span>
          ))}
        </p>
        <span className="splash-chip relative rounded-chip border-2 border-night bg-night px-5 py-2 text-xl font-extrabold text-lime">
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
