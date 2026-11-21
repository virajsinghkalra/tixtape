import type { MetadataRoute } from "next";
import { SITE_URL as SITE } from "@/lib/site";

/** D-084 (UX plan #13): everything public is crawlable; admin and the API aren't. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/offline"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
