/**
 * Visitor city (D-050). Order of precedence:
 *   1. the city the visitor chose in the switcher (cookie `city`); the value `ALL_INDIA` ("all")
 *      means they chose "All India", which must win over the IP city (else it can't be picked),
 *   2. Vercel's free IP geolocation header (`x-vercel-ip-city`, URL-encoded), production only,
 *   3. null → the UI shows "All India".
 * City names are canonicalised (Bombay → Mumbai) so they match stored venues.
 */
import { ALL_INDIA_CITY, canonicalCity } from "@/domain/events/venue";

export const CITY_COOKIE = "city";
/** Cookie value for an explicit "All India" choice (an empty cookie would fall back to IP). */
export const ALL_INDIA = ALL_INDIA_CITY;

export type VisitorCity = { city: string; source: "chosen" | "ip" } | null;

function clean(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  value = value.trim();
  if (value.length < 2 || value.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(value)) return null;
  return canonicalCity(value);
}

/** Works with `next/headers` results or a Request's headers. */
export function visitorCity(input: {
  headers: { get(name: string): string | null };
  cookie?: string | null;
}): VisitorCity {
  if (input.cookie?.trim().toLowerCase() === ALL_INDIA) return null;
  const chosen = clean(input.cookie);
  if (chosen) return { city: chosen, source: "chosen" };
  const ip = clean(input.headers.get("x-vercel-ip-city"));
  if (ip) return { city: ip, source: "ip" };
  return null;
}
