import { describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, PLAYLIST_STEP_SPOTIFY_HTTP } from "./playlists-module";
import { LEASE_MS, REQUEST_TIMEOUT_MS, WRITE_LEASE_MARGIN_MS } from "@/application/playlists";

describe("fetchWithTimeout (D-045)", () => {
  const hung = vi.fn(
    (_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) =>
        init?.signal?.addEventListener("abort", () => rej(init.signal?.reason)),
      ),
  );

  it("aborts a request that takes too long", async () => {
    await expect(fetchWithTimeout(hung as never, 20)("https://x.invalid")).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("still honours the caller's own signal", async () => {
    const caller = new AbortController();
    const p = fetchWithTimeout(hung as never, 60_000)("https://x.invalid", {
      signal: caller.signal,
    });
    caller.abort(new Error("cancelled"));
    await expect(p).rejects.toThrow("cancelled");
  });

  it("keeps a whole Spotify write well inside the lease", () => {
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(6_000);
    const worstWriteMs =
      PLAYLIST_STEP_SPOTIFY_HTTP.maxAttempts! * REQUEST_TIMEOUT_MS +
      PLAYLIST_STEP_SPOTIFY_HTTP.maxWaitSeconds! * 1000;
    expect(worstWriteMs).toBeLessThanOrEqual(WRITE_LEASE_MARGIN_MS);
    expect(WRITE_LEASE_MARGIN_MS).toBeLessThan(LEASE_MS);
  });
});
