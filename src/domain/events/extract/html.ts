/**
 * HTML → plain text for the free extractors (P1.11). Pure and regex-based: inputs are small
 * (one RSS item, one card) and we only need readable sentences, not a DOM.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  nearr: "↗",
};

/** Decodes named (common subset) and numeric character references. Unknown names are kept. */
export function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, ref: string) => {
    if (ref.startsWith("#x") || ref.startsWith("#X")) return codePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return codePoint(parseInt(ref.slice(1), 10));
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

const BLOCK_TAGS =
  /<\/?(?:p|div|br|li|ul|ol|h[1-6]|figure|figcaption|section|article|tr|td|th|blockquote)\b[^>]*>/giu;
/** Inline tags that sit inside words ("13<sup>th</sup>") are removed without a space. */
const GLUED_TAGS = /<\/?(?:sup|sub)\b[^>]*>/giu;

/** Readable text: one line per block element, whitespace collapsed within lines. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!\[CDATA\[|\]\]>/gu, "")
    .replace(/<(script|style|svg|noscript)\b[^>]*>[\s\S]*?<\/\1>/giu, " ")
    .replace(/<!--[\s\S]*?-->/gu, " ")
    // HTML whitespace: a newline in the source is a space; only block tags break lines.
    .replace(/\s+/gu, " ")
    .replace(GLUED_TAGS, "")
    .replace(BLOCK_TAGS, "\n")
    .replace(/<[^>]+>/gu, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/gu, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}
