/**
 * D-084: the public origin for absolute URLs (OG images, canonicals, sitemap, JSON-LD). Local and
 * preview builds without an https APP_URL fall back to production.
 */
export const SITE_URL = process.env.APP_URL?.startsWith("https://")
  ? process.env.APP_URL.replace(/\/$/, "")
  : "https://tixtape.vercel.app";
