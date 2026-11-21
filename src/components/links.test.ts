import { describe, expect, it } from "vitest";
import type { SpotifyArtistId } from "@/domain/shared/ids";
import { spotifyArtistUrl, ticketUrl } from "./links";

describe("ticketUrl", () => {
  it("returns the first source that has a URL", () => {
    expect(
      ticketUrl([{ url: null }, { url: "https://tickets.example/a" }, { url: "https://b" }]),
    ).toBe("https://tickets.example/a");
  });

  it("returns null when no source has one", () => {
    expect(ticketUrl([{ url: null }])).toBeNull();
    expect(ticketUrl([])).toBeNull();
  });
});

describe("spotifyArtistUrl", () => {
  it("links to the artist on Spotify", () => {
    expect(spotifyArtistUrl("4Z8W4fKeB5YxbusRsdQVPb" as SpotifyArtistId)).toBe(
      "https://open.spotify.com/artist/4Z8W4fKeB5YxbusRsdQVPb",
    );
  });
});
