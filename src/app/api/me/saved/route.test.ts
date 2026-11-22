import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";

const savedShowsOf = vi.fn();
const applySavedChanges = vi.fn();
vi.mock("@/server/analytics", () => ({
  savedShowsOf: (...a: unknown[]) => savedShowsOf(...a),
  applySavedChanges: (...a: unknown[]) => applySavedChanges(...a),
}));
const { GET, POST, DELETE } = await import("./route");

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  resetEnvForTests();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});
beforeEach(() => {
  savedShowsOf.mockReset().mockResolvedValue({ synced: false, shows: [] });
  applySavedChanges.mockReset().mockResolvedValue(false);
});

const DID = "0b0f6a52-8d1e-4a1f-9a77-1d1b7d7e2c11";
const EV = "c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3";
const URL_ = "https://tixtape.example/api/me/saved";
const send = (h: typeof POST, method: string, body: unknown) =>
  h(new Request(URL_, { method, body: JSON.stringify(body) }), {});

describe("/api/me/saved (D-092)", () => {
  it("GET needs the device header and answers no-store", async () => {
    expect((await GET(new Request(URL_), {})).status).toBe(400);
    const res = await GET(new Request(URL_, { headers: { "x-tixtape-device": DID } }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ synced: false, shows: [] });
    expect(savedShowsOf).toHaveBeenCalledWith(expect.any(Request), DID);
  });

  it("POST clamps future times and passes saves and removes", async () => {
    const res = await send(POST, "POST", {
      did: DID,
      saves: [{ eventId: EV, at: "2099-01-01T00:00:00Z" }],
    });
    expect(res.status).toBe(200);
    const changes = applySavedChanges.mock.calls[0]?.[2];
    expect(changes.saves[0].at.getTime()).toBeLessThan(Date.now() + 6 * 60_000);
    expect(changes.removes).toEqual([]);
  });

  it("DELETE records one unsave", async () => {
    await send(DELETE, "DELETE", { did: DID, eventId: EV, at: "2026-11-20T10:00:00Z" });
    expect(applySavedChanges.mock.calls[0]?.[2]).toEqual({
      saves: [],
      removes: [{ eventId: EV, at: new Date("2026-11-20T10:00:00Z") }],
    });
  });

  it.each([
    [{ did: "x", saves: [] }],
    [{ did: DID, saves: [{ eventId: "nope", at: "2026-11-20T10:00:00Z" }] }],
    [
      {
        did: DID,
        saves: Array.from({ length: 51 }, () => ({ eventId: EV, at: "2026-11-20T10:00:00Z" })),
      },
    ],
    [{ did: DID, personId: EV }],
  ])("rejects %o", async (body) => {
    expect((await send(POST, "POST", body)).status).toBe(400);
    expect(applySavedChanges).not.toHaveBeenCalled();
  });
});
