import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, newNonce } from "@/lib/csp";

/**
 * D-084 (QA security): a per-request nonce CSP for pages. Next reads the nonce from the request's
 * CSP header and puts it on its own scripts. Every page is already rendered per request, so a
 * nonce costs no static caching. API routes, static files and images keep the static policy
 * from next.config and skip this.
 */
export function middleware(request: NextRequest) {
  const csp = contentSecurityPolicy({
    nonce: newNonce(),
    dev: process.env.NODE_ENV !== "production",
  });
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api/|_next/static|_next/image|fonts/|sw\\.js|manifest\\.webmanifest|robots\\.txt|sitemap\\.xml|icon|apple-icon|opengraph-image|events/[^/]+/share-image).*)",
      // Router prefetches carry no HTML, so they need no nonce.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
