import { describe, expect, it } from "vitest";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { SpotifyRateGate } from "./rate-gate";
import { FakeClock, MemoryGateStore, T0 } from "./test-support";

function setup() {
  const clock = new FakeClock();
  const store = new MemoryGateStore();
  return { clock, store, gate: new SpotifyRateGate(store, clock) };
}

describe("SpotifyRateGate", () => {
  it("is open when no pause is stored or the pause has passed", async () => {
    const { gate, store } = setup();
    await expect(gate.assertOpen()).resolves.toBeUndefined();
    store.pausedUntil = new Date(T0 - 1);
    await expect(gate.assertOpen()).resolves.toBeUndefined();
  });

  it("throws gate_paused with the stored deadline while paused", async () => {
    const { gate, store } = setup();
    store.pausedUntil = new Date(T0 + 10_000);
    const error = await gate.assertOpen().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpotifyBlockedError);
    expect(error).toMatchObject({ reason: "gate_paused", resumeAfter: new Date(T0 + 10_000) });
  });

  it("reads the store on every check while open (D-032)", async () => {
    const { gate, store } = setup();
    await gate.assertOpen();
    store.pausedUntil = new Date(T0 + 3_600_000);
    await expect(gate.assertOpen()).rejects.toBeInstanceOf(SpotifyBlockedError);
    expect(store.reads).toBe(2);
  });

  it("skips the read while a known pause is active, and re-reads once it ends", async () => {
    const { gate, store, clock } = setup();
    store.pausedUntil = new Date(T0 + 5000);
    await expect(gate.assertOpen()).rejects.toBeInstanceOf(SpotifyBlockedError);
    await expect(gate.assertOpen()).rejects.toBeInstanceOf(SpotifyBlockedError);
    expect(store.reads).toBe(1);
    clock.advance(5000);
    await gate.assertOpen();
    expect(store.reads).toBe(2);
  });

  it("uses its own pause immediately, and keeps the later of two deadlines", async () => {
    const { gate, store } = setup();
    expect(await gate.pauseUntil(new Date(T0 + 5000))).toEqual(new Date(T0 + 5000));
    await expect(gate.assertOpen()).rejects.toBeInstanceOf(SpotifyBlockedError);
    expect(await gate.pauseUntil(new Date(T0 + 1000))).toEqual(new Date(T0 + 5000));
    expect(store.reads).toBe(0);
  });
});
