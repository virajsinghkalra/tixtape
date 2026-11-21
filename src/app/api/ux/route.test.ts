import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";

const noteUx = vi.fn();
vi.mock("@/server/ux", () => ({ noteUx: (m: string) => noteUx(m) }));
const { POST } = await import("./route");

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  resetEnvForTests();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});
beforeEach(() => noteUx.mockClear());

const post = (body: unknown) =>
  POST(
    new Request("https://tixtape.example/api/ux", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    {},
  );

describe("POST /api/ux", () => {
  it("counts an allow-listed event", async () => {
    expect((await post({ metric: "install_accepted" })).status).toBe(204);
    expect(noteUx).toHaveBeenCalledWith("install_accepted");
  });

  it("stores a vital as route group and rating only", async () => {
    const path = "/events/c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3";
    expect((await post({ vital: "lcp", value: 3100, path })).status).toBe(204);
    expect(noteUx).toHaveBeenCalledWith("vitals:event:lcp:ni");
  });

  it.each([
    [{ metric: "user_42_visited" }],
    [{ metric: "og_hit", extra: 1 }],
    [{ vital: "fid", value: 1, path: "/" }],
    [{ vital: "lcp", value: -1, path: "/" }],
    [{ vital: "lcp", value: 1, path: "https://evil.example/" }],
    ["not json"],
  ])("rejects %o without counting", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(noteUx).not.toHaveBeenCalled();
  });
});
