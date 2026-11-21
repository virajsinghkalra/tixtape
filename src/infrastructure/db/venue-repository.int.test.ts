import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "../../../tests/setup/db";
import { truncateEventTables } from "./events-test-db";
import { PgVenueRepository } from "./venue-repository";

const db = testDb();
const repo = new PgVenueRepository(db);
afterAll(() => db.$close());
beforeEach(() => truncateEventTables(db));

const nsci = {
  name: "NSCI Dome",
  normalizedName: "nsci dome",
  city: "Mumbai",
  state: "MH",
  country: "IN",
  lat: 19.0,
  lng: 72.81,
};

describe("PgVenueRepository", () => {
  it("creates idempotently on (normalized name, city)", async () => {
    const a = await repo.create(nsci);
    const b = await repo.create({ ...nsci, name: "NSCI DOME" });
    expect(b.id).toBe(a.id);
    expect(b).toEqual({ ...nsci, id: a.id });
    expect(await repo.findById(a.id)).toEqual(a);
  });

  it("finds by name or alias within the city only", async () => {
    const v = await repo.create(nsci);
    await repo.addAlias(v.id, "dome svp stadium");
    await repo.addAlias(v.id, "dome svp stadium");
    expect((await repo.findByName("nsci dome", "Mumbai"))?.id).toBe(v.id);
    expect((await repo.findByName("dome svp stadium", "Mumbai"))?.id).toBe(v.id);
    expect(await repo.findByName("dome svp stadium", "Pune")).toBeNull();
    expect(await repo.findByName("jio world garden", "Mumbai")).toBeNull();
  });

  it("lists a city's venues with their aliases", async () => {
    const v = await repo.create(nsci);
    const other = await repo.create({
      ...nsci,
      name: "Jio World Garden",
      normalizedName: "jio world garden",
    });
    await repo.create({ ...nsci, city: "Pune" });
    await repo.addAlias(v.id, "dome svp stadium");
    const list = await repo.listByCity("Mumbai", "IN");
    expect(list.map((x) => [x.id, x.aliases]).sort()).toEqual(
      [
        [v.id, ["dome svp stadium"]],
        [other.id, []],
      ].sort(),
    );
  });
});
