import { describe, expect, it } from "vitest";
import type { SpotifyArtistId } from "@/domain/shared/ids";
import { spotifyArtistUrl, ticketLink, ticketUrl } from "./links";

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

describe("ticketLink (UX #5, OD-5)", () => {
  it("prefers a ticket seller over a news page", () => {
    expect(
      ticketLink([
        "https://rollingstoneindia.com/charlie-puth-india/",
        "https://www.district.in/events/charlie-puth",
      ]),
    ).toEqual({
      url: "https://www.district.in/events/charlie-puth",
      kind: "tickets",
      label: "🎟️ Tickets",
    });
  });
  it("official festival sites count as tickets", () => {
    expect(ticketLink(["https://sunburn.in/event/sunburn-festival-2026"])?.kind).toBe("tickets");
  });
  it("a news article is 'Info', never 'Buy tickets'", () => {
    expect(
      ticketLink(["https://news.livenationentertainment.com/news/lollapalooza-india-2027"]),
    ).toMatchObject({ kind: "info", label: "ℹ️ Info ↗" });
    expect(ticketLink(["https://news.livenation.in/lolla"])?.kind).toBe("info");
    expect(ticketLink(["https://www.livenation.in/event/lolla-tickets"])?.kind).toBe("tickets");
  });
  it("no links: nothing", () => {
    expect(ticketLink([null, undefined])).toBeNull();
  });
});
