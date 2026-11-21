import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";

const acceptBeacon = vi.fn();
vi.mock("@/server/analytics", () => ({
  acceptBeacon: (...args: unknown[]) => acceptBeacon(...args),
}));
const { POST } = await import("./route");

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  resetEnvForTests();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});
beforeEach(() => acceptBeacon.mockClear());

const DID = "0b0f6a52-8d1e-4a1f-9a77-1d1b7d7e2c11";
const post = (body: string) =>
  POST(new Request("https://tixtape.example/api/t", { method: "POST", body }), {});

describe("POST /api/t (D-090)", () => {
  it("accepts an allow-listed batch sent as text (sendBeacon) and answers 204", async () => {
    const res = await post(
      JSON.stringify({ did: DID, ev: [{ n: "page_view", p: { path: "home" } }] }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(acceptBeacon).toHaveBeenCalledTimes(1);
    expect(acceptBeacon.mock.calls[0]?.[1]).toEqual({
      did: DID,
      ev: [{ n: "page_view", p: { path: "home" } }],
    });
  });

  it.each([
    ["unknown event", JSON.stringify({ did: DID, ev: [{ n: "buy" }] })],
    ["smuggled prop", JSON.stringify({ did: DID, ev: [{ n: "install", p: { email: "a@b.co" } }] })],
    ["bad device id", JSON.stringify({ did: "me", ev: [{ n: "install" }] })],
    [
      "oversized body",
      JSON.stringify({ did: DID, ev: [{ n: "install" }], pad: "x".repeat(10_000) }),
    ],
    ["not JSON", "hello"],
  ])("rejects %s with 400 and stores nothing", async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(acceptBeacon).not.toHaveBeenCalled();
  });
});
