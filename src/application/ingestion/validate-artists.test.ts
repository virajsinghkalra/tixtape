import { describe, expect, it } from "vitest";
import { FakeArtistRepository } from "@/application/events/testing/fakes";
import { FakeArtistCatalog, spotifyArtist } from "@/application/matching/testing/fakes";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { asSpotifyArtistId } from "@/domain/shared/ids";
import { createMemoryValidationCache } from "./ports";
import { ArtistValidator } from "./validate-artists";

const clock = { now: () => new Date("2026-11-21T10:00:00Z") };

function setup(catalog: FakeArtistCatalog, artists = new FakeArtistRepository()) {
  const cache = createMemoryValidationCache();
  return { validator: new ArtistValidator({ catalog, artists, cache, clock }), cache, catalog };
}

describe("ArtistValidator", () => {
  it("confirms only exact normalized name matches, with Spotify's spelling", async () => {
    const { validator } = setup(
      new FakeArtistCatalog({
        "taba chake": [spotifyArtist("3a2b3c4d5e6f7g8h9i0j1k", "Taba Chake", 0)],
        Gini: [spotifyArtist("4a2b3c4d5e6f7g8h9i0j1k", "Ginuwine", 0)],
      }),
    );
    expect(await validator.confirm("taba chake")).toBe("Taba Chake");
    expect(await validator.confirm("Gini")).toBeNull();
  });

  it("tries the whole name first, then its parts", async () => {
    const { validator, catalog } = setup(
      new FakeArtistCatalog({
        "Above & Beyond": [spotifyArtist("5a2b3c4d5e6f7g8h9i0j1k", "Above & Beyond", 0)],
        Kayan: [spotifyArtist("6a2b3c4d5e6f7g8h9i0j1k", "Kayan", 0)],
        Gini: [spotifyArtist("7a2b3c4d5e6f7g8h9i0j1k", "Gini", 0)],
      }),
    );
    const leaf = (name: string) => ({ name, parts: [] });
    expect(
      await validator.validate({ name: "Above & Beyond", parts: [leaf("Above"), leaf("Beyond")] }),
    ).toEqual(["Above & Beyond"]);
    expect(
      await validator.validate({ name: "Kayan & Gini", parts: [leaf("Kayan"), leaf("Gini")] }),
    ).toEqual(["Kayan", "Gini"]);
    expect(catalog.queries).toEqual(["Above & Beyond", "Kayan & Gini", "Kayan", "Gini"]);
  });

  it("caches verdicts, including 'not an artist'", async () => {
    const { validator, catalog, cache } = setup(new FakeArtistCatalog({}));
    await validator.confirm("Mahalaxmi");
    await validator.confirm("mahalaxmi");
    expect(catalog.queries).toEqual(["Mahalaxmi"]);
    expect(await cache.get("mahalaxmi")).toEqual({
      confirmed: null,
      spotifyId: null,
      checkedAt: clock.now(),
    });
    // A new validator (a later run) reads the shared cache instead of calling Spotify.
    const again = new ArtistValidator({
      catalog,
      artists: new FakeArtistRepository(),
      cache,
      clock,
    });
    expect(await again.confirm("Mahalaxmi")).toBeNull();
    expect(again.searches).toBe(0);
  });

  it("uses artists we already matched without calling Spotify", async () => {
    const artists = new FakeArtistRepository();
    const a = await artists.findOrCreateByName("Ritviz", "ritviz");
    Object.assign(a, {
      spotifyId: asSpotifyArtistId("72beYOeW2sb2yfcS4JsRvb"),
      matchStatus: "auto",
    });
    const { validator, catalog } = setup(new FakeArtistCatalog({}), artists);
    expect(await validator.confirm("RITVIZ")).toBe("Ritviz");
    expect(catalog.queries).toEqual([]);
  });

  it("lets a Spotify block propagate and does not remember it as a verdict", async () => {
    const blocked = new SpotifyBlockedError("gate_paused", new Date("2026-11-21T11:00:00Z"));
    const catalog = new FakeArtistCatalog({}).failOn("Kayan", blocked);
    const { validator, cache } = setup(catalog);
    await expect(validator.confirm("Kayan")).rejects.toBe(blocked);
    expect(await cache.get("kayan")).toBeUndefined();
  });
});

describe("ArtistValidator cache upgrades", () => {
  it("re-searches a confirmed name cached without its Spotify ID, once", async () => {
    const cache = createMemoryValidationCache();
    await cache.set("kayan", { confirmed: "Kayan", checkedAt: clock.now() });
    const catalog = new FakeArtistCatalog({
      Kayan: [spotifyArtist("6a2b3c4d5e6f7g8h9i0j1k", "Kayan", 0)],
    });
    const v = new ArtistValidator({ catalog, artists: new FakeArtistRepository(), cache, clock });
    expect(await v.confirm("Kayan")).toBe("Kayan");
    expect(v.spotifyIdOf("Kayan")).toBe("6a2b3c4d5e6f7g8h9i0j1k");
    const again = new ArtistValidator({
      catalog,
      artists: new FakeArtistRepository(),
      cache,
      clock,
    });
    await again.confirm("Kayan");
    expect(catalog.queries).toEqual(["Kayan"]);
  });
});
