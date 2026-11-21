import { describe, expect, it } from "vitest";
import {
  bestVenueMatch,
  canonicalCity,
  normalizeCity,
  normalizeVenueName,
  SAME_VENUE_THRESHOLD,
  venueSimilarity,
} from "./venue";

describe("normalizeVenueName", () => {
  it.each([
    ["Mahalaxmi Racecourse", undefined, "mahalaxmi racecourse"],
    ["Mahalakshmi Race Course", undefined, "mahalaxmi racecourse"],
    ["MAHALAXMI RACE COURSE, Mumbai", "Mumbai", "mahalaxmi racecourse"],
    ["NSCI Dome, Mumbai", "Bombay", "nsci dome"],
    ["Dome @ NSCI SVP Stadium", "Mumbai", "nsci dome"],
    ["D.Y. Patil Stadium", undefined, "dy patil stadium"],
    ["Dr. D Y Patil Sports Stadium", "Navi Mumbai", "dy patil stadium"],
    ["Palace Grounds", "Bengaluru", "palace ground"],
    ["The Jio World Garden", undefined, "jio world garden"],
    ["Jio World Center", undefined, "jio world centre"],
    ["Jawaharlal Nehru Std.", "New Delhi", "jawaharlal nehru stadium"],
    ["JLN Stadium", "Delhi", "jawaharlal nehru stadium"],
    ["Huda Grounds, Gurgaon", "Gurugram", "huda ground"],
    ["Zénith Arena", undefined, "zenith arena"],
    ["Bandstand & Lawns", undefined, "bandstand and lawns"],
    ["Kingdom of Dreams India", "Gurugram", "kingdom of dreams"],
    ["Mumbai", "Mumbai", "mumbai"],
  ])("%j (city %j) → %j", (raw, city, expected) => {
    expect(normalizeVenueName(raw, city)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const raw of ["Mahalakshmi Race Course", "D.Y. Patil Stadium", "NSCI Dome, Mumbai"]) {
      const once = normalizeVenueName(raw, "Mumbai");
      expect(normalizeVenueName(once, "Mumbai")).toBe(once);
    }
  });
});

describe("venueSimilarity", () => {
  it.each([
    ["Mahalaxmi Racecourse", "Mahalakshmi Race Course", 1],
    ["NSCI Dome", "NSCI DOME, Mumbai", 1],
    ["Phoenix Marketcity", "Phoenix Market City", 0.98],
  ])("%j ~ %j ≥ %f", (a, b, min) => {
    expect(venueSimilarity(a, b, "Mumbai")).toBeGreaterThanOrEqual(min);
  });

  it.each([
    ["Jio World Garden", "Jio World Centre"],
    ["Jawaharlal Nehru Stadium", "Indira Gandhi Stadium"],
    ["Palace Grounds", "Jayamahal Palace"],
  ])("%j and %j stay distinct venues", (a, b) => {
    expect(venueSimilarity(a, b, "Mumbai")).toBeLessThan(SAME_VENUE_THRESHOLD);
  });
});

describe("bestVenueMatch", () => {
  const venues = [
    { id: 1, normalizedNames: ["jio world garden"] },
    { id: 2, normalizedNames: ["jio world centre", "jwcc"] },
    { id: 3, normalizedNames: ["bhartiya city"] },
  ];

  it.each([
    ["bharatiya city", 3],
    ["jio world centre", 2],
    ["jwcc", 2],
    ["nesco centre", null],
    ["jio world", null],
  ])("%j → venue %j", (name, expectedId) => {
    expect(bestVenueMatch(name, venues)?.id ?? null).toBe(expectedId);
  });
});

describe("cities", () => {
  it.each([
    ["Bombay", "Mumbai", "mumbai"],
    ["MUMBAI", "Mumbai", "mumbai"],
    ["Bangalore", "Bengaluru", "bengaluru"],
    ["Bengaluru", "Bengaluru", "bengaluru"],
    [" bengaluru ", "Bengaluru", "bengaluru"],
    ["New Delhi", "Delhi", "delhi"],
    ["Gurgaon", "Gurugram", "gurugram"],
    ["Madras", "Chennai", "chennai"],
    ["Calcutta", "Kolkata", "kolkata"],
    ["Poona", "Pune", "pune"],
    ["Cochin", "Kochi", "kochi"],
    ["Navi Mumbai", "Navi Mumbai", "navi mumbai"],
    ["Vagator", "Goa", "goa"],
    ["São Paulo", "Sao Paulo", "sao paulo"],
    ["new york", "New York", "new york"],
  ])("%j → %j / %j", (raw, display, key) => {
    expect(canonicalCity(raw)).toBe(display);
    expect(normalizeCity(raw)).toBe(key);
  });
});
