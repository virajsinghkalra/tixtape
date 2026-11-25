/**
 * Content Security Policy (D-070, D-084). Pages get a per-request nonce from `src/middleware.ts`:
 * scripts run only when they carry the nonce, or when a nonce'd script loads them
 * ('strict-dynamic'). 'unsafe-inline' and https: stay as fallbacks for old browsers that don't
 * understand nonces; browsers that do ignore them. Without a nonce (API and static responses,
 * set by next.config) the old policy applies. Dev also needs `eval` and a websocket for HMR.
 * Styles stay 'unsafe-inline' because `motion` animates with inline styles.
 */
export function contentSecurityPolicy({ nonce, dev }: { nonce?: string; dev: boolean }): string {
  const scripts = nonce
    ? `'nonce-${nonce}' 'strict-dynamic' 'self' https: 'unsafe-inline'`
    : `'self' 'unsafe-inline'`;
  return [
    "default-src 'self'",
    `script-src ${scripts}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    // The in-page player ("Listen here") is Spotify's embed.
    "frame-src https://open.spotify.com",
    "object-src 'none'",
    "base-uri 'self'",
    // Login redirects to Spotify's consent page.
    "form-action 'self' https://accounts.spotify.com",
    "frame-ancestors 'none'",
    // No `upgrade-insecure-requests`: it would break `next start` on http://127.0.0.1 (perf and
    // E2E runs). Vercel serves https only, and HSTS keeps browsers there.
  ].join("; ");
}

/** 128 random bits, base64: a fresh nonce for every page response. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
