/**
 * D-080 call budget for a real-sized festival: 24 matched artists over 2 × 8 h (like HOME
 * Festival), counted per Spotify endpoint with the fake's call log.
 */
import { describe, expect, it } from "vitest";
import type { PlaylistJobId } from "@/domain/shared/ids";
import type { BillingTier } from "@/domain/shared/lineup";
import { UNIT_START_LIMIT_MS } from "./build-step";
import { playlistWorld } from "./testing/fakes";

type World = ReturnType<typeof playlistWorld>;

const HOME_TIERS: BillingTier[] = [
  ...Array<BillingTier>(2).fill("headliner"),
  ...Array<BillingTier>(4).fill("sub"),
  ...Array<BillingTier>(9).fill("mid"),
  ...Array<BillingTier>(9).fill("support"),
];

const TWO_DAYS = {
  startsAt: new Date("2026-12-29T08:30:00Z"), // 14:00 IST
  endsAt: new Date("2026-12-30T16:30:00Z"), // 22:00 IST next day
};

function homeFestival(w: World) {
  const lineup = HOME_TIERS.map((tier, i) => {
    const name = `Artist ${String.fromCharCode(65 + i)}`;
    return { name, tier, spotifyId: w.spotify.addArtist(name, 60, 225_000).id };
  });
  return w.events.add(lineup, TWO_DAYS);
}

async function build(w: World, eventId: string) {
  const r = await w.useCases.startSharedBuild(eventId as never, "ip");
  if (r.status !== "building") throw new Error("expected building");
  let steps = 0;
  let longestStepMs = 0;
  for (; steps < 200;) {
    const before = w.clock.now().getTime();
    const p = await w.useCases.step(r.jobId as PlaylistJobId);
    steps++;
    longestStepMs = Math.max(longestStepMs, w.clock.now().getTime() - before);
    if (p.status === "succeeded" || p.status === "partial") return { steps, longestStepMs, p };
    if (p.resumeAfter) w.clock.advance(p.resumeAfter.getTime() - w.clock.now().getTime() + 1);
  }
  throw new Error("did not finish");
}

const count = (calls: readonly string[], op: string) => calls.filter((c) => c === op).length;

describe("D-080 Spotify call budget, 24-artist festival", () => {
  it("cold cache: ~2 searches per artist (≤ 3), then create + 3 writes", async () => {
    const w = playlistWorld({ callMs: 300 });
    const event = homeFestival(w);
    const { steps, longestStepMs } = await build(w, event.id);
    const calls = w.spotify.calls;

    const searches = count(calls, "search");
    expect(searches).toBeLessThanOrEqual(3 * 24);
    // Tier-sized pages: 2 headliners × 5, 4 subs × 3, 9 mids × 2, 9 supports × 1.
    expect(searches).toBe(2 * 5 + 4 * 3 + 9 * 2 + 9 * 1);
    expect(count(calls, "albums") + count(calls, "albumTracks")).toBe(0);
    expect(count(calls, "create")).toBe(1);
    expect(count(calls, "replace") + count(calls, "add")).toBe(3);
    const items = [...w.spotify.playlists.values()][0]!;
    expect(items.length).toBeGreaterThanOrEqual(220);
    expect(items.length).toBeLessThanOrEqual(270); // 256 planned + up to half a song per artist
    expect(longestStepMs).toBeLessThanOrEqual(UNIT_START_LIMIT_MS + 6 * 300);
    expect(steps).toBeGreaterThan(1);
  });

  it("warm cache (another event with the same artists): 0 searches, done in ≤ 2 steps", async () => {
    const w = playlistWorld({ callMs: 300 });
    const first = homeFestival(w);
    await build(w, first.id);
    const second = w.events.add(
      structuredClone(first.lineup).map((a) => ({ ...a })),
      { ...TWO_DAYS, title: "HOME Festival · Day pass" },
    );
    // Same artist rows: the song cache is keyed by artist, not by event.
    w.events.rows.get(second.id)!.lineup = structuredClone(first.lineup);
    const before = w.spotify.calls.length;
    const { steps } = await build(w, second.id);
    const calls = w.spotify.calls.slice(before);
    expect(count(calls, "search")).toBe(0);
    expect(calls).toEqual(["create", "replace", "add", "add"]);
    expect(steps).toBeLessThanOrEqual(2);
  });

  it("pre-warm fills the cache so the build only writes", async () => {
    const w = playlistWorld({ callMs: 300 });
    const event = homeFestival(w);
    const warm = await w.useCases.prewarmEvent(event.id, {
      deadline: new Date(w.clock.now().getTime() + 3_600_000),
    });
    expect(warm).toMatchObject({ artists: 24, alreadyCached: 0, resolved: 24, remaining: 0 });
    const estimate = await w.useCases.estimatePlaylist(event.id);
    expect(estimate.readiness).toEqual({ cachedArtists: 24, artists: 24, seconds: 5 });

    const before = w.spotify.calls.length;
    const { steps } = await build(w, event.id);
    expect(w.spotify.calls.slice(before)).toEqual(["create", "replace", "add", "add"]);
    expect(steps).toBeLessThanOrEqual(2);
  });

  it("the estimate says how long a cold build will take", async () => {
    const w = playlistWorld();
    const event = homeFestival(w);
    const { readiness } = await w.useCases.estimatePlaylist(event.id);
    expect(readiness.cachedArtists).toBe(0);
    expect(readiness.artists).toBe(24);
    // 24 artists × ≤ 3 calls at the app-wide pace, plus the writes: about a minute and a half.
    expect(readiness.seconds).toBeGreaterThan(60);
    expect(readiness.seconds).toBeLessThan(120);
  });

  it("pre-warm stops cleanly at its deadline and when Spotify pauses", async () => {
    const w = playlistWorld({ callMs: 1_000 });
    const event = homeFestival(w);
    const r = await w.useCases.prewarmEvent(event.id, {
      deadline: new Date(w.clock.now().getTime() + 10_000),
    });
    expect(r.resolved).toBeGreaterThan(0);
    expect(r.remaining).toBeGreaterThan(0);
    expect(r.resolved + r.remaining).toBe(24);
  });
});
