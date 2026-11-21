import { describe, expect, it } from "vitest";
import { visitorCity } from "./location";

const h = (city?: string) => ({
  get: (n: string) => (n === "x-vercel-ip-city" ? (city ?? null) : null),
});

describe("visitorCity (D-050)", () => {
  it.each([
    [
      "chosen cookie wins over IP",
      { headers: h("Delhi"), cookie: "Pune" },
      { city: "Pune", source: "chosen" },
    ],
    ["IP header used when no cookie", { headers: h("Mumbai") }, { city: "Mumbai", source: "ip" }],
    [
      "URL-encoded IP city (New Delhi is stored as Delhi)",
      { headers: h("New%20Delhi") },
      { city: "Delhi", source: "ip" },
    ],
    ["old names are canonicalised", { headers: h("Bombay") }, { city: "Mumbai", source: "ip" }],
    ["no data → null", { headers: h() }, null],
    [
      "garbage cookie ignored, falls back to IP",
      { headers: h("Pune"), cookie: "<script>" },
      { city: "Pune", source: "ip" },
    ],
    ["malformed encoding ignored", { headers: h("%E0%A4%A") }, null],
    ["too long ignored", { headers: h("x".repeat(80)) }, null],
  ] as const)("%s", (_label, input, expected) => {
    expect(visitorCity(input)).toEqual(expected);
  });
});
