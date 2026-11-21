/** Chunky lowercase "tixtape" wordmark with a slapped-on sticker (D-077). */
export function Wordmark() {
  return (
    <span className="flex items-center gap-1 font-display text-xl leading-none font-extrabold tracking-tight">
      tix
      <span className="inline-block -rotate-3 rounded-chip border-2 border-night bg-lime px-2 py-0.5 text-on-block">
        tape
      </span>
    </span>
  );
}
