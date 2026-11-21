/**
 * Indian cities and venues in free text (P1.11). Cities come from the shared alias table
 * (`knownCity`), so "Bombay" and "Gurgaon" resolve like everywhere else.
 */
import { foldText } from "../text";
import { knownCity } from "../venue";

export type KnownVenue = { name: string; city: string; aliases: readonly string[] };

/** Large Indian concert venues. `aliases` are folded spellings seen in coverage. */
export const KNOWN_VENUES: readonly KnownVenue[] = [
  {
    name: "Mahalaxmi Racecourse",
    city: "Mumbai",
    aliases: ["mahalakshmi racecourse", "mahalaxmi race course", "mahalakshmi race course"],
  },
  { name: "NSCI Dome", city: "Mumbai", aliases: ["nsci svp stadium dome", "dome svp stadium"] },
  { name: "Jio World Garden", city: "Mumbai", aliases: ["jio garden"] },
  { name: "Jio World Centre", city: "Mumbai", aliases: ["jio world convention centre"] },
  { name: "DY Patil Stadium", city: "Navi Mumbai", aliases: ["d y patil stadium", "dr dy patil"] },
  { name: "Jawaharlal Nehru Stadium", city: "Delhi", aliases: ["jln stadium"] },
  { name: "Embassy International Riding School", city: "Bengaluru", aliases: ["eirs"] },
  { name: "Bhartiya City", city: "Bengaluru", aliases: [] },
  { name: "Palace Grounds", city: "Bengaluru", aliases: [] },
  { name: "Huda Ground", city: "Gurugram", aliases: ["huda grounds leisure valley"] },
  { name: "Leisure Valley Ground", city: "Gurugram", aliases: [] },
  { name: "Mahalunge Ground", city: "Pune", aliases: [] },
  { name: "Gachibowli Stadium", city: "Hyderabad", aliases: [] },
  { name: "Vagator Hills", city: "Goa", aliases: [] },
];

/** Every token span of length 1–3 in the folded text, in reading order. */
function* spans(folded: string): Generator<{ text: string; index: number }> {
  const words = folded.split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 3; n >= 1; n--) {
      if (i + n <= words.length) yield { text: words.slice(i, i + n).join(" "), index: i };
    }
  }
}

/** The first Indian city named in the text, as its canonical name ("Bombay" → "Mumbai"). */
export function findCity(text: string): string | null {
  for (const span of spans(foldText(text))) {
    const city = knownCity(span.text);
    if (city) return city;
  }
  return null;
}

/** Every distinct Indian city named in the text, in reading order. */
export function findCities(text: string): string[] {
  const out: string[] = [];
  for (const span of spans(foldText(text))) {
    const city = knownCity(span.text);
    if (city && !out.includes(city)) out.push(city);
  }
  return out;
}

const contains = (haystack: string, needle: string) =>
  ` ${haystack} `.includes(` ${needle} `) && needle !== "";

/** A known venue named in the text, else "at <Proper Name>, <City>" / "at <Proper Name> in <City>". */
export function findVenue(text: string): { name: string; city: string } | null {
  const folded = foldText(text);
  for (const v of KNOWN_VENUES) {
    const forms = [foldText(v.name), ...v.aliases];
    if (forms.some((f) => contains(folded, f))) return { name: v.name, city: v.city };
  }
  const pattern =
    /\bat (?:the )?((?:[\p{Lu}][\p{L}'’.-]*\s?){1,5}?(?:Stadium|Ground|Grounds|Arena|Dome|Garden|Gardens|Centre|Center|Club|Racecourse|Amphitheatre|Park|Hall|Auditorium|Lawns))(?:,| in)\s+([\p{Lu}][\p{L}]+(?: [\p{Lu}][\p{L}]+)?)/u;
  const m = pattern.exec(text);
  if (!m?.[1] || !m[2]) return null;
  const city = knownCity(foldText(m[2]));
  return city ? { name: m[1].trim(), city } : null;
}
