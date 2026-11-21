import { describe, expect, it } from "vitest";
import { resolveVenue } from "./resolve-venue";
import { FakeVenueRepository } from "./testing/fakes";

const mahalaxmi = { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" };

describe("resolveVenue", () => {
  it("creates a venue with canonical city and normalized name", async () => {
    const venues = new FakeVenueRepository();
    const v = await resolveVenue(venues, { ...mahalaxmi, city: "Bombay", state: "MH" });
    expect(v).toMatchObject({
      name: "Mahalaxmi Racecourse",
      normalizedName: "mahalaxmi racecourse",
      city: "Mumbai",
      state: "MH",
      country: "IN",
      lat: null,
    });
  });

  it.each([
    ["alias table spelling", "Mahalakshmi Race Course"],
    ["city appended", "MAHALAXMI RACECOURSE, Mumbai"],
  ])("reuses the venue for %s", async (_label, name) => {
    const venues = new FakeVenueRepository();
    const first = await resolveVenue(venues, mahalaxmi);
    const second = await resolveVenue(venues, { ...mahalaxmi, name });
    expect(second.id).toBe(first.id);
    expect(venues.venues).toHaveLength(1);
  });

  it("fuzzy-matches a near spelling in the same city and records it as an alias", async () => {
    const venues = new FakeVenueRepository();
    const first = await resolveVenue(venues, {
      name: "Bhartiya City",
      city: "Bangalore",
      country: "IN",
    });
    const second = await resolveVenue(venues, {
      name: "Bharatiya City",
      city: "Bengaluru",
      country: "IN",
    });
    expect(second.id).toBe(first.id);
    expect(venues.venues[0]!.aliases).toEqual(["bharatiya city"]);
    // The alias now resolves exactly.
    expect(await venues.findByName("bharatiya city", "Bengaluru")).toMatchObject({ id: first.id });
  });

  it.each([
    ["a different venue in the same city", { name: "Jio World Centre", city: "Mumbai" }],
    ["the same name in another city", { name: "Jio World Garden", city: "Pune" }],
  ])("creates a new venue for %s", async (_label, other) => {
    const venues = new FakeVenueRepository();
    const first = await resolveVenue(venues, {
      name: "Jio World Garden",
      city: "Mumbai",
      country: "IN",
    });
    const second = await resolveVenue(venues, { ...other, country: "IN" });
    expect(second.id).not.toBe(first.id);
  });
});
