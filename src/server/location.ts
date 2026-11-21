/**
 * Visitor city (D-050). Order of precedence:
 *   1. the city the visitor chose in the switcher (cookie `city`),
 *   2. Vercel's free IP geolocation header (`x-vercel-ip-city`, URL-encoded), production only,
 *   3. null → the UI shows "All India".
 * City names are canonicalised (Bombay → Mumbai) so they match stored venues.
 */
import { canonicalCity } from "@/domain/events/venue";

export const CITY_COOKIE = "city";

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
  const chosen = clean(input.cookie);
  if (chosen) return { city: chosen, source: "chosen" };
  const ip = clean(input.headers.get("x-vercel-ip-city"));
  if (ip) return { city: ip, source: "ip" };
  return null;
}
