/**
 * The key for rate limits on anonymous endpoints (D-070). Never logged; the Postgres limits
 * store only an HMAC of it.
 *
 * Only headers the platform sets are trusted: on Vercel, `x-real-ip`, else the first entry of
 * `x-vercel-forwarded-for` (Vercel overwrites both). A raw `x-forwarded-for` is client-controlled,
 * so it is ignored. Off Vercel (local dev, tests) every caller shares one constant key.
 */
import { isVercel } from "@/lib/env";

export const LOCAL_CLIENT_KEY = "local";

export function clientKey(req: Request): string {
  if (!isVercel()) return LOCAL_CLIENT_KEY;
  const realIp = req.headers.get("x-real-ip")?.trim();
  const vercelForwarded = req.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim();
  return realIp || vercelForwarded || "unknown";
}
