/**
 * Registrable domain (eTLD+1) for source independence (D-074): two pages count as two sources
 * only when their registrable domains differ ("www.highape.com" and "highape.com" are one;
 * "in.bookmyshow.com" and "bookmyshow.com" are one). Pure; a small list of two-level public
 * suffixes covers the hosts we read (India, UK, Australia). Unknown suffixes fall back to the
 * last two labels.
 */
const TWO_LEVEL_SUFFIXES = new Set([
  "co.in",
  "org.in",
  "net.in",
  "gov.in",
  "ac.in",
  "edu.in",
  "firm.in",
  "gen.in",
  "ind.in",
  "co.uk",
  "org.uk",
  "com.au",
  "net.au",
  "co.nz",
]);

/** "https://www.rollingstoneindia.com/x" → "rollingstoneindia.com"; null for a non-http URL. */
export function registrableDomain(url: string): string | null {
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return null;
  }
  if (/^[\d.]+$/u.test(host) || host.includes(":")) return host;
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

/** True when the URL's host is `domain` or a subdomain of it. */
export function onDomain(url: string, domain: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
