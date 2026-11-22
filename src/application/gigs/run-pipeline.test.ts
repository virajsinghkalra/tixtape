import { describe, expect, it, vi } from "vitest";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import { runPipeline, type PipelineStep } from "./run-pipeline";

const now = new Date("2026-11-22T10:16:00Z");
const gateUntil = new Date("2026-11-22T12:03:00Z");

function steps(over: Partial<Record<string, () => Promise<unknown>>> = {}) {
  const calls: string[] = [];
  const make = (name: string, needsSpotify: boolean): PipelineStep => ({
    name,
    needsSpotify,
    run: async () => {
      calls.push(name);
      return over[name] ? over[name]!() : undefined;
    },
  });
  return {
    calls,
    list: [
      make("listings", true),
      make("discovery", true),
      make("enrich", false),
      make("publish", false),
      make("reverify", false),
    ],
  };
}

describe("runPipeline: a closed Spotify gate is a soft skip", () => {
  it("defers Spotify steps when the gate is already closed, runs the rest, and doesn't fail", async () => {
    const { calls, list } = steps();
    const r = await runPipeline(list, { now, spotifyPausedUntil: gateUntil });
    expect(calls).toEqual(["enrich", "publish", "reverify"]);
    expect(r.failed).toBe(false);
    expect(r.deferred).toEqual([
      "listings: deferred: spotify gate until 2026-11-22T12:03:00.000Z",
      "discovery: deferred: spotify gate until 2026-11-22T12:03:00.000Z",
    ]);
  });

  it("a SpotifyBlockedError mid-run (the 10:16 UTC crash) defers that and later Spotify steps", async () => {
    const { calls, list } = steps({
      listings: async () => {
        throw new SpotifyBlockedError("long_retry_after", gateUntil);
      },
    });
    const r = await runPipeline(list, { now, spotifyPausedUntil: null });
    expect(calls).toEqual(["listings", "enrich", "publish", "reverify"]);
    expect(r.failed).toBe(false);
    expect(r.steps.map((s) => s.status)).toEqual(["deferred", "deferred", "done", "done", "done"]);
  });

  it("a step that reports blockedUntil (partial work) is deferred too", async () => {
    const { list } = steps({ discovery: async () => ({ blockedUntil: gateUntil }) });
    const r = await runPipeline(list, { now, spotifyPausedUntil: null });
    expect(r.steps.find((s) => s.name === "discovery")?.status).toBe("deferred");
    expect(r.failed).toBe(false);
  });

  it("a gate that reopened before now doesn't defer anything", async () => {
    const { calls, list } = steps();
    await runPipeline(list, { now, spotifyPausedUntil: new Date("2026-11-22T09:00:00Z") });
    expect(calls).toHaveLength(5);
  });

  it("real errors still fail the run, but the remaining steps run so the report is complete", async () => {
    const { calls, list } = steps({
      publish: vi.fn(async () => {
        throw new Error("database is down");
      }),
    });
    const r = await runPipeline(list, { now, spotifyPausedUntil: null });
    expect(r.failed).toBe(true);
    expect(calls).toContain("reverify");
    expect(r.steps.find((s) => s.name === "publish")).toEqual({
      name: "publish",
      status: "failed",
      detail: "database is down",
    });
  });
});
