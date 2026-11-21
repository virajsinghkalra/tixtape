import type { Random } from "@/application/ports/clock";

const DELTA_SECONDS = /^\d+(\.\d+)?$/;
const HTTP_DATE = /^[A-Za-z]{3},? .+ GMT$|^[A-Za-z]{3} [A-Za-z]{3} .+ \d{4}$/;

/**
 * Seconds to wait from a `Retry-After` header: delta-seconds or an HTTP-date (RFC 9110 §10.2.3).
 * Returns null when the header is missing or unparseable, never NaN. Past dates give 0.
 */
export function parseRetryAfter(header: string | null, now: Date): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (DELTA_SECONDS.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? seconds : null;
  }
  if (!HTTP_DATE.test(value)) return null;
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (at - now.getTime()) / 1000);
}

/** Full jitter (D-006): rand(0, min(cap, base * 2^attempt)) seconds. `attempt` starts at 1. */
export function fullJitterSeconds(
  attempt: number,
  random: Random,
  baseSeconds = 1,
  capSeconds = 60,
) {
  return random.next() * Math.min(capSeconds, baseSeconds * 2 ** attempt);
}
