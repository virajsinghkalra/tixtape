/**
 * Venue and city normalization (P1.4, venue half; D-013 keeps artist names in
 * src/domain/shared/normalize.ts). Pure: the alias tables are data, not IO.
 */
import { jaroWinkler } from "./similarity";
import { foldText as fold } from "./text";

/** "d y patil" → "dy patil": a run of two or more single letters is one set of initials. */
function joinInitials(words: string[]): string[] {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run) out.push(run);
    run = "";
  };
  for (const w of words) {
    if (w.length === 1 && /\p{L}/u.test(w)) {
      run += w;
      continue;
    }
    flush();
    out.push(w);
  }
  flush();
  return out;
}

/** Word-level spellings standardized so "Grounds"/"Ground", "Centre"/"Center" compare equal. */
const WORD_STANDARD: Readonly<Record<string, string>> = {
  grounds: "ground",
  stadia: "stadium",
  std: "stadium",
  stdm: "stadium",
  intl: "international",
  center: "centre",
  theater: "theatre",
  amphitheater: "amphitheatre",
};

/** Multi-word spellings joined into one canonical token. */
const PHRASE_STANDARD: ReadonlyArray<readonly [RegExp, string]> = [
  [/\brace course\b/gu, "racecourse"],
  [/\brace club\b/gu, "raceclub"],
  [/\bopen air\b/gu, "openair"],
];

/**
 * Known alternative names for Indian venues, keyed by the canonical normalized name.
 * Values are normalized forms (output of `standardizeVenueName`), so the lookup is exact.
 */
const VENUE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "mahalaxmi racecourse": ["mahalakshmi racecourse", "rwitc mahalaxmi racecourse"],
  "nsci dome": ["nsci svp stadium dome", "dome nsci svp stadium", "dome svp stadium"],
  "dy patil stadium": [
    "dr dy patil stadium",
    "dr dy patil sports stadium",
    "dy patil sports stadium",
  ],
  "jawaharlal nehru stadium": ["jln stadium"],
  "embassy international riding school": ["eirs"],
  "jio world garden": ["jio garden", "jio world garden bkc"],
  "jio world centre": ["jio world convention centre", "jwcc"],
  "huda ground": ["huda grounds leisure valley"],
  "bhartiya city": ["bhartiya city nikoo homes"],
};

const ALIAS_TO_CANONICAL: ReadonlyMap<string, string> = new Map(
  Object.entries(VENUE_ALIASES).flatMap(([canonical, aliases]) =>
    aliases.map((a) => [a, canonical] as const),
  ),
);

function standardizeVenueName(raw: string): string {
  const words = joinInitials(fold(raw).split(" ").filter(Boolean)).map(
    (w) => WORD_STANDARD[w] ?? w,
  );
  let name = words.join(" ");
  for (const [pattern, replacement] of PHRASE_STANDARD) name = name.replace(pattern, replacement);
  return name.replace(/^the /u, "");
}

/**
 * Drops a trailing city or country ("NSCI Dome, Mumbai" → "nsci dome"), including an old
 * name of the same city ("Huda Grounds, Gurgaon" in Gurugram). Keeps at least one word.
 */
function stripTrailingPlace(name: string, cityKey: string | null): string {
  const words = name.split(" ");
  for (let changed = true; changed;) {
    changed = false;
    for (let n = Math.min(3, words.length - 1); n >= 1; n--) {
      const suffix = words.slice(-n).join(" ");
      if (suffix === "india" || (cityKey !== null && normalizeCity(suffix) === cityKey)) {
        words.splice(-n);
        changed = true;
        break;
      }
    }
  }
  return words.join(" ");
}

/**
 * The comparison key for a venue name: folded, standardized and alias-resolved.
 * Pass the venue's city to drop it when the source appends it to the name.
 * Idempotent for a fixed city: `normalizeVenueName(normalizeVenueName(x, c), c) === normalizeVenueName(x, c)`.
 */
export function normalizeVenueName(raw: string, city?: string): string {
  const cityKey = city === undefined ? null : normalizeCity(city);
  const name = stripTrailingPlace(standardizeVenueName(raw), cityKey);
  return ALIAS_TO_CANONICAL.get(name) ?? name;
}

/** Jaro-Winkler over normalized names; 1 when both resolve to the same canonical venue. */
export function venueSimilarity(a: string, b: string, city?: string): number {
  return jaroWinkler(normalizeVenueName(a, city), normalizeVenueName(b, city));
}

/** Score at which two venue names in the same city are treated as the same venue. */
export const SAME_VENUE_THRESHOLD = 0.95;

/** The best-scoring candidate at or above `SAME_VENUE_THRESHOLD`, or null. Inputs are normalized names. */
export function bestVenueMatch<T extends { normalizedNames: readonly string[] }>(
  normalizedName: string,
  candidates: readonly T[],
): T | null {
  let best: { candidate: T; score: number } | null = null;
  for (const candidate of candidates) {
    for (const name of candidate.normalizedNames) {
      const score = jaroWinkler(normalizedName, name);
      if (score >= SAME_VENUE_THRESHOLD && (best === null || score > best.score)) {
        best = { candidate, score };
      }
    }
  }
  return best?.candidate ?? null;
}

// ── Cities ────────────────────────────────────────────────────────────────

/** Old or alternative city names → the canonical display name. Keys are folded. */
const CITY_ALIASES: Readonly<Record<string, string>> = {
  bombay: "Mumbai",
  mumbai: "Mumbai",
  "greater mumbai": "Mumbai",
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  bengalooru: "Bengaluru",
  madras: "Chennai",
  chennai: "Chennai",
  calcutta: "Kolkata",
  kolkata: "Kolkata",
  "new delhi": "Delhi",
  delhi: "Delhi",
  "delhi ncr": "Delhi",
  "new delhi ncr": "Delhi",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  poona: "Pune",
  pune: "Pune",
  cochin: "Kochi",
  kochi: "Kochi",
  trivandrum: "Thiruvananthapuram",
  thiruvananthapuram: "Thiruvananthapuram",
  mysore: "Mysuru",
  mysuru: "Mysuru",
  baroda: "Vadodara",
  vadodara: "Vadodara",
  benares: "Varanasi",
  banaras: "Varanasi",
  varanasi: "Varanasi",
  mangalore: "Mangaluru",
  mangaluru: "Mangaluru",
  hyderabad: "Hyderabad",
  secunderabad: "Hyderabad",
  "navi mumbai": "Navi Mumbai",
  thane: "Thane",
  noida: "Noida",
  ahmedabad: "Ahmedabad",
  jaipur: "Jaipur",
  goa: "Goa",
  "north goa": "Goa",
  "south goa": "Goa",
  panaji: "Goa",
  panjim: "Goa",
  vagator: "Goa",
  shillong: "Shillong",
  chandigarh: "Chandigarh",
  indore: "Indore",
  lucknow: "Lucknow",
};

/** The canonical name if `folded` is a city we know (incl. old names), else null: "bombay" → "Mumbai". */
export function knownCity(folded: string): string | null {
  return CITY_ALIASES[folded] ?? null;
}

/** Canonical display name for a city: "Bombay" → "Mumbai", "BANGALORE" → "Bengaluru", "Paris" → "Paris". */
export function canonicalCity(raw: string): string {
  const folded = fold(raw);
  const known = CITY_ALIASES[folded];
  if (known) return known;
  return folded
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The comparison key for a city (used by the dedupe blocking key): "Bombay" → "mumbai". */
export function normalizeCity(raw: string): string {
  return fold(canonicalCity(raw));
}
