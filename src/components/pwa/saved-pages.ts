/** The event title from a saved page's <title> ("Lolla India · Tixtape" → "Lolla India"). */
export function savedPageTitle(html: string): string {
  const raw = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? "";
  const title = decodeEntities(raw)
    .replace(/\s*·\s*Tixtape\s*$/, "")
    .trim();
  return title || "Saved gig";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'");
}
