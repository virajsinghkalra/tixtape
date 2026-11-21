import type { MetadataRoute } from "next";

/**
 * "Add to Home Screen" metadata (D-077 branding, D-084 installability). The maskable icons are
 * full-bleed with the mark inside the 80% safe zone; the rounded "any" icons keep their corners.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Tixtape",
    short_name: "Tixtape",
    description: "Every ticket gets a mixtape: one shared Spotify playlist for every concert.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
    categories: ["music", "entertainment"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Search gigs",
        short_name: "Search",
        url: "/search",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
