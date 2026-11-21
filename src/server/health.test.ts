import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/container", () => ({ container: () => ({}) }));
const { checkHealth } = await import("./health");

describe("checkHealth", () => {
  it("is ok with the ping time when the database answers", async () => {
    let t = 1000;
    const health = await checkHealth(
      async () => {
        t += 12;
      },
      () => t,
    );
    expect(health).toEqual({ status: "ok", db: "ok", dbMs: 12 });
  });

  it("is degraded, with no error details, when the ping fails", async () => {
    const health = await checkHealth(async () => {
      throw new Error("password authentication failed for user app");
    });
    expect(health).toEqual({ status: "degraded", db: "down", dbMs: null });
    expect(JSON.stringify(health)).not.toMatch(/password|app/);
  });

  it("is degraded when the ping hangs", async () => {
    vi.useFakeTimers();
    const pending = checkHealth(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ db: "down" });
    vi.useRealTimers();
  });
});
