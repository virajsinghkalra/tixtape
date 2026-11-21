import { describe, expect, it, vi } from "vitest";
import { liveLookup, viewFromLookup, worthLookingUp } from "./live-lookup";

describe("worthLookingUp", () => {
  it.each([
    ["coldplay", true],
    ["arijit singh", true],
    ["AP Dhillon", true],
    ["zzzqqqxxx", false],
    ["%_%", false],
    ["' OR 1=1--", false],
    ["🎸🔥", false],
    ["दिलजीत", false],
    ["ab", false],
    ["lolla".repeat(20), false],
  ])("%s → %s", (q, expected) => {
    expect(worthLookingUp(q)).toBe(expected);
  });
});

describe("viewFromLookup", () => {
  const event = {
    id: "e1",
    title: "Coldplay Live",
    type: "concert",
    startsAt: "2027-01-01T13:30:00Z",
  };
  it("found, not found (with or without the artist), searching (with lookupId and early artist)", () => {
    expect(viewFromLookup("coldplay", 200, { status: "found", results: [event] })).toMatchObject({
      kind: "found",
      results: [{ id: "e1", matchReason: "title" }],
    });
    expect(
      viewFromLookup("coldplay", 200, { status: "not_found", artist: { name: "Coldplay" } }),
    ).toMatchObject({
      kind: "not_found",
      artist: { name: "Coldplay" },
      candidates: [],
    });
    expect(
      viewFromLookup("coldplay", 202, {
        status: "searching",
        lookupId: "L1",
        artists: [{ name: "Coldplay" }],
      }),
    ).toEqual({ pending: true, lookupId: "L1", artist: { name: "Coldplay" } });
  });

  it("a partial name matching several artists returns up to 3 candidates", () => {
    const many = [1, 2, 3, 4].map((i) => ({ name: `Olivia ${i}` }));
    expect(
      viewFromLookup("olivia", 200, { status: "not_found", ambiguous: true, artists: many }),
    ).toMatchObject({
      kind: "not_found",
      candidates: many.slice(0, 3),
    });
  });

  it.each([
    [404, {}],
    [429, {}],
    [500, {}],
    [200, { status: "weird" }],
  ])("HTTP %i fails silently", (status, raw) => {
    expect(viewFromLookup("coldplay", status, raw)).toBeNull();
  });
});

describe("liveLookup (async, D-057)", () => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const noWait = async () => {};

  it("POSTs, then polls GET /api/lookup/:id, reporting the artist early", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "searching", lookupId: "L1" }, 202))
      .mockResolvedValueOnce(
        json({ status: "searching", lookupId: "L1", artists: [{ name: "Coldplay" }] }),
      )
      .mockResolvedValueOnce(json({ status: "not_found", artist: { name: "Coldplay" } }));
    const updates: unknown[] = [];
    const view = await liveLookup("coldplay", new AbortController().signal, {
      fetchFn,
      wait: noWait,
      onUpdate: (v) => updates.push(v),
    });
    expect(fetchFn.mock.calls.map((c) => String(c[0]))).toEqual([
      "/api/lookup",
      "/api/lookup/L1",
      "/api/lookup/L1",
    ]);
    expect(updates).toEqual([{ kind: "looking", query: "coldplay", artist: { name: "Coldplay" } }]);
    expect(view).toMatchObject({ kind: "not_found" });
  });

  it("gives up silently after ~8s of searching, on a network error, or when aborted", async () => {
    let t = 0;
    const searching = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json({ status: "searching", lookupId: "L" }));
    const view = await liveLookup("coldplay", new AbortController().signal, {
      fetchFn: searching,
      wait: async (ms) => void (t += ms),
      now: () => t,
    });
    expect(view).toBeNull();
    expect(searching.mock.calls.length).toBeLessThanOrEqual(13);

    const broken = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(
      await liveLookup("coldplay", new AbortController().signal, { fetchFn: broken }),
    ).toBeNull();

    const aborted = new AbortController();
    aborted.abort();
    expect(await liveLookup("coldplay", aborted.signal, { fetchFn: searching })).toBeNull();
  });
});
