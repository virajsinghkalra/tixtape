/**
 * QA P1.4 (venues): normalization, city canonicalization, similarity metrics and resolveVenue.
 * Written from LLD §4/§5.3 and the public interface only.
 */
import { describe, expect, it } from "vitest";
import type {
  NewVenue,
  Venue,
  VenueRepository,
  VenueWithAliases,
} from "@/application/ports/venues";
import { resolveVenue } from "@/application/events/resolve-venue";
import { diceOverlap, jaccard, jaroWinkler } from "@/domain/events/similarity";
import {
  bestVenueMatch,
  canonicalCity,
  normalizeCity,
  normalizeVenueName,
  venueSimilarity,
} from "@/domain/events/venue";
import { asVenueId, type VenueId } from "@/domain/shared/ids";

describe("QA canonicalCity / normalizeCity", () => {
  it.each([
    ["Bombay", "Mumbai"],
    ["mumbai", "Mumbai"],
    ["BANGALORE", "Bengaluru"],
    ["Bengaluru", "Bengaluru"],
    ["Gurgaon", "Gurugram"],
    ["gurugram", "Gurugram"],
    ["  Bombay  ", "Mumbai"],
  ])("canonicalCity(%j) = %j", (raw, want) => {
    expect(canonicalCity(raw)).toBe(want);
  });

  it.each([
    ["Bombay", "Mumbai"],
    ["Bangalore", "Bengaluru"],
    ["Gurgaon", "Gurugram"],
    ["Calcutta", "Kolkata"],
    ["Madras", "Chennai"],
  ])("normalizeCity treats %s and %s as the same city", (a, b) => {
    expect(normalizeCity(a)).toBe(normalizeCity(b));
  });

  it("folds diacritics and case", () => {
    expect(normalizeCity("São Paulo")).toBe(normalizeCity("sao paulo"));
    expect(normalizeCity("MÜNCHEN")).toBe(normalizeCity("münchen"));
  });

  it("keeps distinct cities distinct", () => {
    expect(normalizeCity("Mumbai")).not.toBe(normalizeCity("Pune"));
    expect(normalizeCity("Delhi")).not.toBe(normalizeCity("Gurugram"));
  });

  it("does not throw on empty / whitespace / huge input", () => {
    expect(() => canonicalCity("")).not.toThrow();
    expect(() => normalizeCity("   ")).not.toThrow();
    expect(() => normalizeCity("x".repeat(100_000))).not.toThrow();
  });
});

describe("QA normalizeVenueName", () => {
  it("resolves the LLD alias example: Mahalaxmi Racecourse = Mahalakshmi Race Course", () => {
    expect(normalizeVenueName("Mahalaxmi Racecourse")).toBe(
      normalizeVenueName("Mahalakshmi Race Course"),
    );
    expect(venueSimilarity("Mahalaxmi Racecourse", "Mahalakshmi Race Course", "Mumbai")).toBe(1);
  });

  it("ignores case, punctuation and diacritics", () => {
    const k = normalizeVenueName("NSCI Dome");
    expect(normalizeVenueName("nsci dome")).toBe(k);
    expect(normalizeVenueName("N.S.C.I. Dome")).toBe(normalizeVenueName("NSCI Dome"));
    expect(normalizeVenueName("Café Mondégar")).toBe(normalizeVenueName("cafe mondegar"));
    expect(normalizeVenueName("  Jio   World   Garden ")).toBe(
      normalizeVenueName("Jio World Garden"),
    );
  });

  it("drops a trailing city when the city is passed, using city aliases too", () => {
    expect(normalizeVenueName("NSCI Dome, Mumbai", "Mumbai")).toBe(
      normalizeVenueName("NSCI Dome", "Mumbai"),
    );
    expect(normalizeVenueName("Phoenix Marketcity, Bangalore", "Bengaluru")).toBe(
      normalizeVenueName("Phoenix Marketcity", "Bengaluru"),
    );
  });

  it("is idempotent for a fixed city", () => {
    for (const raw of ["Mahalaxmi Racecourse", "NSCI Dome, Mumbai", "Café Mondégar", "The O2"]) {
      const once = normalizeVenueName(raw, "Mumbai");
      expect(normalizeVenueName(once, "Mumbai")).toBe(once);
    }
  });

  it("does not throw on empty, whitespace-only or very long input", () => {
    expect(() => normalizeVenueName("")).not.toThrow();
    expect(() => normalizeVenueName("   \t\n")).not.toThrow();
    const long = "Stadium ".repeat(20_000);
    const t0 = performance.now();
    expect(typeof normalizeVenueName(long)).toBe("string");
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("QA similarity metrics", () => {
  const pairs: [string, string][] = [
    ["martha", "marhta"],
    ["dwayne", "duane"],
    ["nsci dome", "nsci dom"],
    ["", "abc"],
    ["", ""],
    ["a", "b"],
    ["jio world garden", "jio world centre"],
  ];

  it.each(pairs)("jaroWinkler(%j,%j) is symmetric and in [0,1]", (a, b) => {
    const x = jaroWinkler(a, b);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(jaroWinkler(b, a)).toBeCloseTo(x, 12);
  });

  it("jaroWinkler: identical → 1, disjoint → 0, known textbook value", () => {
    expect(jaroWinkler("nsci dome", "nsci dome")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.9611, 3);
  });

  it("jaccard / diceOverlap: bounds, symmetry, empties, duplicates", () => {
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3, 12);
    expect(jaccard(["a", "b"], ["b", "a"])).toBe(1);
    expect(jaccard(["a", "a", "b"], ["a", "b"])).toBe(1);
    expect(diceOverlap(["a", "b"], ["b", "c"])).toBeCloseTo(0.5, 12);
    expect(diceOverlap(["b", "c"], ["a", "b"])).toBeCloseTo(0.5, 12);
    for (const v of [
      jaccard([], []),
      diceOverlap([], []),
      jaccard([], ["a"]),
      diceOverlap(["a"], []),
    ]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    ["NSCI Dome", "NSCI Dome, Mumbai"],
    ["Mahalaxmi Racecourse", "Jio World Garden"],
    ["", "NSCI Dome"],
    ["Café Mondégar", "Cafe Mondegar"],
  ])("venueSimilarity(%j,%j) symmetric, in [0,1]", (a, b) => {
    const s = venueSimilarity(a, b, "Mumbai");
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
    expect(venueSimilarity(b, a, "Mumbai")).toBeCloseTo(s, 12);
  });

  it("venueSimilarity of identical names is 1", () => {
    expect(venueSimilarity("Jio World Garden", "Jio World Garden")).toBe(1);
    expect(venueSimilarity("Jio World Garden", "JIO WORLD GARDEN")).toBe(1);
  });
});

describe("QA bestVenueMatch", () => {
  const c = (id: string, ...normalizedNames: string[]) => ({ id, normalizedNames });

  it("returns null for no candidates or none ≥ 0.95", () => {
    expect(bestVenueMatch("nsci dome", [])).toBeNull();
    expect(bestVenueMatch("nsci dome", [c("x", "jio world garden")])).toBeNull();
  });

  it("matches an exact name and prefers the best score", () => {
    const hit = bestVenueMatch(normalizeVenueName("Jio World Garden"), [
      c("a", normalizeVenueName("Jio World Centre")),
      c("b", normalizeVenueName("Jio World Garden")),
    ]);
    expect(hit?.id).toBe("b");
  });

  it("matches via any of a candidate's names (aliases)", () => {
    const hit = bestVenueMatch("abc arena", [c("a", "zzz", "abc arena")]);
    expect(hit?.id).toBe("a");
  });

  it("threshold is ≥ 0.95 (inclusive) — a pair just under is rejected", () => {
    // Find a pair under 0.95 and verify rejection; consistency with jaroWinkler.
    const a = "dwayne";
    const b = "duane";
    expect(jaroWinkler(a, b)).toBeLessThan(0.95);
    expect(bestVenueMatch(a, [c("x", b)])).toBeNull();
  });
});

// ── resolveVenue with an in-memory repository that honours the port contract ──

class MemVenues implements VenueRepository {
  rows: Venue[] = [];
  aliases: { venueId: VenueId; alias: string }[] = [];
  creates = 0;
  async findById(id: VenueId) {
    return this.rows.find((v) => v.id === id) ?? null;
  }
  async findByName(normalizedName: string, city: string) {
    const direct = this.rows.find((v) => v.normalizedName === normalizedName && v.city === city);
    if (direct) return direct;
    const al = this.aliases.find(
      (a) => a.alias === normalizedName && this.rows.find((v) => v.id === a.venueId)?.city === city,
    );
    return al ? (this.rows.find((v) => v.id === al.venueId) ?? null) : null;
  }
  async listByCity(city: string, country: string): Promise<VenueWithAliases[]> {
    return this.rows
      .filter((v) => v.city === city && v.country === country)
      .map((v) => ({
        ...v,
        aliases: this.aliases.filter((a) => a.venueId === v.id).map((a) => a.alias),
      }));
  }
  async create(v: NewVenue) {
    const existing = this.rows.find(
      (r) => r.normalizedName === v.normalizedName && r.city === v.city,
    );
    if (existing) return existing;
    this.creates++;
    const row = { ...v, id: asVenueId(`v${this.rows.length + 1}`) };
    this.rows.push(row);
    return row;
  }
  async addAlias(venueId: VenueId, alias: string) {
    if (!this.aliases.some((a) => a.venueId === venueId && a.alias === alias)) {
      this.aliases.push({ venueId, alias });
    }
  }
}

describe("QA resolveVenue", () => {
  const raw = (name: string, city: string, country = "IN") => ({ name, city, country });

  it("stores the canonical city (Bombay → Mumbai)", async () => {
    const repo = new MemVenues();
    const v = await resolveVenue(repo, raw("NSCI Dome", "Bombay"));
    expect(v.city).toBe("Mumbai");
  });

  it("same venue spelled with old city name / alias spelling resolves to one row", async () => {
    const repo = new MemVenues();
    const a = await resolveVenue(repo, raw("Mahalakshmi Race Course", "Mumbai"));
    const b = await resolveVenue(repo, raw("Mahalaxmi Racecourse", "Bombay"));
    const c = await resolveVenue(repo, raw("MAHALAXMI RACECOURSE, Mumbai", "mumbai"));
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(repo.creates).toBe(1);
  });

  it("is idempotent", async () => {
    const repo = new MemVenues();
    const a = await resolveVenue(repo, raw("Phoenix Marketcity", "Bangalore"));
    const b = await resolveVenue(repo, raw("Phoenix Marketcity", "Bengaluru"));
    expect(b.id).toBe(a.id);
    expect(repo.rows).toHaveLength(1);
  });

  it("does not merge same-named venues in different cities", async () => {
    const repo = new MemVenues();
    const a = await resolveVenue(repo, raw("Phoenix Marketcity", "Mumbai"));
    const b = await resolveVenue(repo, raw("Phoenix Marketcity", "Pune"));
    expect(b.id).not.toBe(a.id);
  });

  it("does not merge clearly different venues in the same city", async () => {
    const repo = new MemVenues();
    const a = await resolveVenue(repo, raw("Jio World Garden", "Mumbai"));
    const b = await resolveVenue(repo, raw("NSCI Dome", "Mumbai"));
    expect(b.id).not.toBe(a.id);
  });
});
