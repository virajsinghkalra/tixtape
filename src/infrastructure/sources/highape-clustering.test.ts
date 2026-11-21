/**
 * D-078 end to end: the real HighApe adapter over its fixtures, then the collector's
 * clustering. HighApe was kept out of ingest.ts because separate club nights clustered.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EventCandidate, ValidatedCandidate } from "@/domain/events/extract/candidate";
import { clusterCandidates } from "@/domain/events/extract/corroborate";
import { HIGHAPE_BASE, HighApeSource } from "./highape";
import { createMemoryHostLog, PoliteFetcher } from "./polite-fetch";

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/highape/${name}`, import.meta.url)), "utf8");
const html = (body: string) => new HttpResponse(body, { headers: { "content-type": "text/html" } });

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NOW = new Date("2026-11-21T10:00:00Z");

async function collectFixtures(): Promise<EventCandidate[]> {
  server.use(
    http.get("https://highape.com/robots.txt", () => new HttpResponse("User-Agent: *\nAllow: /\n")),
    http.get(`${HIGHAPE_BASE}/bangalore`, () => html(fixture("bangalore.html"))),
    http.get(`${HIGHAPE_BASE}/mumbai`, () => html(fixture("mumbai.html"))),
  );
  let now = NOW.getTime();
  const fetcher = new PoliteFetcher({
    fetch: (...args) => fetch(...args),
    sleep: async (ms) => {
      now += ms;
    },
    clock: { now: () => new Date(now) },
    logger: { warn: vi.fn() },
    hostLog: createMemoryHostLog(),
    resolve: async () => ["93.184.216.34"],
  });
  const src = new HighApeSource({
    fetcher,
    logger: { warn: vi.fn() },
    cities: ["bangalore", "mumbai"],
  });
  const out: EventCandidate[] = [];
  for await (const c of src.collect({ now: NOW })) out.push(c);
  return out;
}

/** The fields clustering reads, as the collector's validation step would produce them. */
const validated = (c: EventCandidate): ValidatedCandidate => ({
  ...c,
  title: c.title ?? c.artists[0]?.name ?? "",
  artists: c.artists.filter((a) => a.role !== "support").map((a) => a.name),
  supportActs: c.artists.filter((a) => a.role === "support").map((a) => a.name),
});

const ids = (clusters: ValidatedCandidate[][]) => clusters.map((cl) => cl.map((c) => c.title));

describe("HighApe club nights through the collector's clustering (D-078)", () => {
  it("every fixture night is its own cluster", async () => {
    const nights = (await collectFixtures()).map(validated);
    expect(nights.length).toBeGreaterThanOrEqual(3);
    expect(ids(clusterCandidates(nights))).toEqual(nights.map((n) => [n.title]));
  });

  it("still separate when every Bengaluru night is moved onto one date at one venue", async () => {
    const blr = (await collectFixtures())
      .map(validated)
      .filter((n) => n.city === "Bengaluru")
      .map((n) => ({
        ...n,
        startsAt: new Date("2026-11-21T20:00:00+05:30"),
        venueName: "HOD Club",
      }));
    // Plus the same brand with another DJ, the shape that used to merge.
    const sameBrand = {
      ...blr[0]!,
      externalId: "other-dj",
      title: "CROSS/OVER Ft Anish Sood",
      artists: ["Anish Sood"],
    };
    const all = [...blr, sameBrand];
    expect(ids(clusterCandidates(all))).toEqual(all.map((n) => [n.title]));
  });

  it("a second source listing the same night still clusters with it", async () => {
    const [first] = (await collectFixtures()).map(validated);
    const press: ValidatedCandidate = {
      ...first!,
      source: "rollingstone",
      trust: "trusted",
      externalId: "rs-crossover",
      url: "https://rollingstoneindia.com/crossover/",
      title: "CROSS/OVER feat. Nikhil Chinapa",
    };
    expect(ids(clusterCandidates([first!, press]))).toEqual([[first!.title, press.title]]);
  });
});
