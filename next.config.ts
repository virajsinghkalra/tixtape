import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./src/lib/csp";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Security headers (D-070, OWASP ASVS V14.4). Pages get a per-request nonce CSP from
 * src/middleware.ts (D-084), which replaces this static policy; API, static and image responses
 * keep this one. Images come from Spotify and event sources over https. Fonts are self-hosted.
 */
const csp = contentSecurityPolicy({ dev: isDev });

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
