/**
 * The opener (user, 24 Nov: random each visit, cool not childish, in the app's own colours,
 * no emojis). Always the brand palette (night, lime, a violet glow); what changes each visit is
 * the line and the centrepiece: a spinning record with its tonearm, the wordmark over live EQ
 * bars, or a genre ticker. Words resolve from blur, then a curtain lifts. Pure CSS: a tap skips
 * it, a refresh in the same visit skips it, and reduced-motion users never see it. ~3 s, home only
 * (data, 26 Nov).
 */
const LINES = [
  ["Every gig.", "Its playlist."],
  ["Press play", "before the show."],
  ["Know every word", "before they do."],
  ["Your next gig,", "pre-played."],
  ["Learn the drops.", "Own the night."],
  ["Front row starts", "in your earphones."],
] as const;
const LOOKS = ["vinyl", "wordmark", "ticker"] as const;
const GENRES = ["EDM", "BOLLYWOOD", "PUNJABI", "INDIE", "HIP HOP", "SUFI", "ROCK", "POP", "K-POP"];

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/**
 * Seen this visit already (a refresh or another page), or landing straight on a gig / Radio
 * link (data, 26 Nov: they came for that gig, not an intro): hide it before first paint with a
 * flag on <html>. Never remove the node: React would put it back while hydrating (and replay it).
 */
const DROP_IF_SEEN = `try{var s=sessionStorage;if(s.getItem("tt.splash")||location.pathname!=="/"){document.documentElement.dataset.splash="seen"}s.setItem("tt.splash","1")}catch(e){}`;

export function Splash({ nonce }: { nonce?: string }) {
  const lines = pick(LINES);
  const look = pick(LOOKS);
  let word = 0;
  const words = (
    <p className="relative font-display text-[2.6rem] leading-[0.95] font-extrabold tracking-tight text-white">
      {lines.map((line, l) => (
        <span key={l} className="block">
          {line.split(" ").map((w) => {
            const i = word++;
            return (
              <span
                key={`${w}-${i}`}
                className="splash-word mx-[0.1em] inline-block"
                style={{ animationDelay: `${(0.35 + i * 0.12).toFixed(2)}s` }}
              >
                {w}
              </span>
            );
          })}
        </span>
      ))}
    </p>
  );
  return (
    <>
      <div
        id="tt-splash"
        aria-hidden
        className="splash fixed inset-0 z-[100] flex flex-col items-center justify-center gap-10 overflow-hidden bg-night px-8 text-center"
      >
        {/* The brand's glow: lime and violet, drifting slowly behind everything. */}
        <span className="splash-glow absolute top-[-20%] left-[-30%] size-[36rem] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-violet)_55%,transparent),transparent_65%)]" />
        <span className="splash-glow splash-glow-b absolute right-[-35%] bottom-[-25%] size-[32rem] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-lime)_30%,transparent),transparent_65%)]" />
        <span className="absolute inset-0 bg-[radial-gradient(rgb(255_255_255/0.05)_1px,transparent_1px)] [background-size:18px_18px]" />

        {look === "vinyl" && (
          <span className="splash-in relative block size-48">
            <span className="vinyl-disc absolute inset-0 rounded-full border border-white/10 bg-[repeating-radial-gradient(circle,#1d1d25_0_1.5px,#0b0b0f_1.5px_4px)] shadow-[0_0_80px_-10px_var(--color-violet)]" />
            <span className="absolute inset-[34%] grid place-items-center rounded-full bg-lime font-display text-sm font-extrabold text-on-block">
              tixtape
            </span>
            <span className="splash-arm absolute -top-4 -right-6 h-28 w-1.5 origin-top rounded-full bg-white/80" />
          </span>
        )}
        {look === "wordmark" && (
          <span className="splash-in flex flex-col items-center gap-5">
            <span className="font-display text-7xl leading-none font-extrabold tracking-tight text-white">
              tix
              <span className="ml-1 rounded-chip bg-lime px-3 text-on-block">tape</span>
            </span>
            <span className="flex h-12 items-end gap-1.5">
              {[0.9, 0.6, 1.1, 0.75, 1, 0.65, 0.95, 0.7, 1.05].map((d, i) => (
                <span
                  key={i}
                  className="splash-bar block w-2 rounded-full bg-lime"
                  style={{ animationDuration: `${d}s`, animationDelay: `${-i * 0.11}s` }}
                />
              ))}
            </span>
          </span>
        )}
        {look === "ticker" && (
          <span className="splash-in absolute inset-x-0 top-[18%] -rotate-6 overflow-hidden border-y border-lime/40 bg-lime py-2">
            <span className="splash-ticker flex w-max gap-6 font-display text-2xl font-extrabold whitespace-nowrap text-on-block">
              {[...GENRES, ...GENRES].map((g, i) => (
                <span key={i} className="flex items-center gap-6">
                  {g} <span className="text-on-block/40">/</span>
                </span>
              ))}
            </span>
          </span>
        )}

        {words}

        {look !== "wordmark" && (
          <span className="splash-chip relative font-display text-xl font-extrabold text-white">
            tix<span className="ml-0.5 rounded-chip bg-lime px-2 text-on-block">tape</span>
          </span>
        )}
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
