/**
 * Search variants for a lineup name (D-066 step 1). Pure.
 * Lineup names are rarely exact Spotify names: "Avneet Music", "Dhyan Live", "MXRCI (Live Set)",
 * "Sazi" (billed elsewhere as "DJ Sazi"), "PRFCT & DARK" (two acts).
 */
import { normalizeArtistName } from "@/domain/shared/normalize";

/**
 * `raw`: the lineup name itself. `variant`: the same act under a cleaned-up name.
 * `collab_part`: one side of a collaboration, a different act from the lineup entry.
 */
export type NameVariantKind = "raw" | "variant" | "collab_part";
export type NameVariant = { name: string; kind: NameVariantKind };

/** Unbracketed trailing words that describe the show or the page, not the act. */
const DESCRIPTOR_SUFFIX = /\s+(?:live set|live|dj set|music|official|the band|band|india)\s*$/iu;
const BRACKETED = /\s*[([][^)\]]*[)\]]\s*$/u;
const LEADING_DJ = /^dj[\s.]+(?=\S)/iu;
/** Collaboration separators, including "&" and "and", which `splitArtistCredit` keeps whole. */
const COLLAB_SEPARATOR = /\s+(?:&|and|x|×|\+|b2b|vs\.?|feat\.?|ft\.?)\s+|\s*&\s*/iu;

function stripDescriptors(name: string): string {
  let current = name.trim();
  for (;;) {
    const next = current.replace(BRACKETED, "").replace(DESCRIPTOR_SUFFIX, "").trim();
    if (next === current || next === "") return current;
    current = next;
  }
}

function toggleDj(name: string): string {
  return LEADING_DJ.test(name) ? name.replace(LEADING_DJ, "") : `DJ ${name}`;
}

/**
 * Ordered most-likely first; deduplicated by normalized name; never empty for a non-blank name.
 * Collab parts come last: they are searched only as a fallback, and never auto-accepted.
 */
export function nameVariants(raw: string): NameVariant[] {
  const name = raw.trim();
  // A name with no letters or digits ("!!!") names nothing to search for.
  if (normalizeArtistName(name) === "") return [];
  const core = stripDescriptors(name);
  const parts = core
    .split(COLLAB_SEPARATOR)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const candidates: NameVariant[] = [
    { name, kind: "raw" },
    { name: core, kind: "variant" },
    ...(parts.length > 1
      ? parts.map((p): NameVariant => ({ name: stripDescriptors(p), kind: "collab_part" }))
      : [{ name: toggleDj(core), kind: "variant" as const }]),
  ];
  const seen = new Set<string>();
  return candidates.filter((v) => {
    // Not `normalizeArtistName`: it folds a leading "DJ", and "DJ Sazi" is a different search.
    const key = v.name.toLowerCase().replace(/\s+/gu, " ");
    if (normalizeArtistName(v.name) === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
