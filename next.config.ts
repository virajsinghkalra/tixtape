import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers (D-070, OWASP ASVS V14.4). The CSP allows inline scripts and styles because
 * Next.js injects inline bootstrap scripts and `motion` animates with inline styles; a nonce CSP
 * would force every page to render dynamically. Dev also needs `eval` and a websocket for HMR.
 * Images come from Spotify and event sources over https. Fonts are self-hosted by next/font.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Login redirects to Spotify's consent page.
  "form-action 'self' https://accounts.spotify.com",
  "frame-ancestors 'none'",
  // No `upgrade-insecure-requests`: it would break `next start` on http://127.0.0.1 (perf and
  // E2E runs). Vercel serves https only, and HSTS keeps browsers there.
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Two years, subdomains, preload-ready. Browsers ignore it over plain http (local).
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // E2E tests run a second dev server with its own build folder and database (D-049).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  // D-084: link-preview cards read their fonts and logo from disk at request time.
  outputFileTracingIncludes: {
    "/events/[id]/share-image": ["./public/fonts/*.ttf", "./src/app/icon.svg"],
    "/opengraph-image": ["./public/fonts/*.ttf", "./src/app/icon.svg"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
