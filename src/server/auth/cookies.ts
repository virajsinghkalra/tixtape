/**
 * Auth cookies (ENGINEERING.md §7, LLD §12). All are httpOnly and SameSite=Lax; Secure except on
 * http://127.0.0.1 during local development (Spotify rejects `localhost` redirect URIs).
 */
import { env } from "@/lib/env";

export const SESSION_COOKIE = "session";
export const OAUTH_STATE_COOKIE = "spotify_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "spotify_oauth_verifier";

/** Long enough to finish the Spotify consent screen. */
const OAUTH_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const OAUTH_COOKIE_PATH = "/api/auth/spotify";

type CookieOptions = { maxAgeSeconds: number; path: string; secure: boolean };

export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${opts.path}`,
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** The first cookie with this name, or null. Malformed encodings are treated as missing. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function shouldUseSecureCookies(appUrl: string, nodeEnv: string): boolean {
  return !(nodeEnv !== "production" && new URL(appUrl).hostname === "127.0.0.1");
}

function secure(): boolean {
  const { APP_URL, NODE_ENV } = env();
  return shouldUseSecureCookies(APP_URL, NODE_ENV);
}

export function sessionCookie(sessionId: string, expiresAt: Date, now: Date): string {
  const maxAgeSeconds = (expiresAt.getTime() - now.getTime()) / 1000;
  return serializeCookie(SESSION_COOKIE, sessionId, { maxAgeSeconds, path: "/", secure: secure() });
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, path: "/", secure: secure() });
}

export function oauthCookies(state: string, codeVerifier: string): string[] {
  const opts = {
    maxAgeSeconds: OAUTH_COOKIE_MAX_AGE_SECONDS,
    path: OAUTH_COOKIE_PATH,
    secure: secure(),
  };
  return [
    serializeCookie(OAUTH_STATE_COOKIE, state, opts),
    serializeCookie(OAUTH_VERIFIER_COOKIE, codeVerifier, opts),
  ];
}

export function clearOauthCookies(): string[] {
  const opts = { maxAgeSeconds: 0, path: OAUTH_COOKIE_PATH, secure: secure() };
  return [
    serializeCookie(OAUTH_STATE_COOKIE, "", opts),
    serializeCookie(OAUTH_VERIFIER_COOKIE, "", opts),
  ];
}

/** A 302 that also sets cookies (Response.redirect can't carry extra headers). */
export function redirectWithCookies(location: string, cookies: readonly string[]): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}
