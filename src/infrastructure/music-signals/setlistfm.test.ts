import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { UpstreamError } from "@/lib/errors";
import page from "./fixtures/setlistfm-charlie-puth.json";
import { SETLISTFM_ATTRIBUTION, SETLISTFM_BASE_URL, SetlistfmScores } from "./setlistfm";

const SEARCH = `${SETLISTFM_BASE_URL}/search/setlists`;
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function source() {
  let now = Date.parse("2026-11-22T10:00:00Z");
  const sleep = vi.fn(async (ms: number) => void (now += ms));
  const clock = { now: () => new Date(now) };
  const src = new SetlistfmScores({ apiKey: "k", fetch: (...a) => fetch(...a), sleep, clock });
  return { src, sleep, advance: (ms: number) => (now += ms) };
}

describe("SetlistfmScores (D-085)", () => {
  it("scores songs by how often recent setlists include them, with a current-tour bonus", async () => {
    const seen: Request[] = [];
    server.use(
      http.get(SEARCH, ({ request }) => {
        seen.push(request);
        return HttpResponse.json(page);
      }),
    );
    const { known, songs } = await source().src.scores("Charlie Puth");
    expect(known).toBe(true);
    const score = Object.fromEntries(songs.map((s) => [s.title, Number(s.score.toFixed(3))]));
    // 3 non-empty setlists of his own (the tribute band and the empty upcoming one don't count).
    expect(score).toEqual({
      Attention: 1,
      "Light Switch": 0.917,
      "We Don't Talk Anymore": 0.583,
      "How Long": 0.583,
      "See You Again": 0.333,
    });
    const url = new URL(seen[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ artistName: "Charlie Puth", p: "1" });
    expect(seen[0]!.headers.get("x-api-key")).toBe("k");
    expect(seen[0]!.headers.get("accept")).toBe("application/json");
    expect(SETLISTFM_ATTRIBUTION).toContain("setlist.fm");
  });

  it.each([
    [
      "404 (no setlists, common for Indian indie acts)",
      () => new HttpResponse(null, { status: 404 }),
    ],
    [
      "only empty or other artists' setlists",
      () => HttpResponse.json({ setlist: [page.setlist[3], page.setlist[4]] }),
    ],
  ])("is unknown on %s", async (_n, reply) => {
    server.use(http.get(SEARCH, reply));
    await expect(source().src.scores("Charlie Puth")).resolves.toEqual({ known: false, songs: [] });
  });

  it.each([
    ["a 429", () => new HttpResponse(null, { status: 429 })],
    ["a malformed body", () => HttpResponse.json({ setlist: [{ artist: 1 }] })],
    ["a network error", () => HttpResponse.error()],
  ])("throws UpstreamError on %s", async (_n, reply) => {
    server.use(http.get(SEARCH, reply));
    await expect(source().src.scores("Charlie Puth")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("paces to 1 request a second and caches per artist", async () => {
    let calls = 0;
    server.use(http.get(SEARCH, () => (calls++, HttpResponse.json(page))));
    const { src, sleep } = source();
    await Promise.all([src.scores("Charlie Puth"), src.scores("A"), src.scores("B")]);
    await src.scores("charlie puth");
    expect(calls).toBe(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 1_000]);
  });
});
