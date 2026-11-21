import type { MetadataRoute } from "next";

/** "Add to Home Screen" metadata (D-077 branding). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tixtape",
    short_name: "Tixtape",
    description: "Every ticket gets a mixtape: one shared Spotify playlist for every concert.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
