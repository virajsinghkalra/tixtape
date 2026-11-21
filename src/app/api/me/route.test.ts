import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asUserId } from "@/domain/shared/ids";
import { resetEnvForTests } from "@/lib/env";
import { DELETE } from "./route";

const user = {
  id: asUserId("u1"),
  spotifyUserId: "sp1",
  displayName: null,
  market: "IN",
  role: "user",
};
const service = {
  getSessionUser: vi.fn(async (id: string) => (id === "good" ? user : null)),
  deleteAccount: vi.fn(async () => {}),
};
vi.mock("@/server/auth/spotify-auth", () => ({ authService: () => service }));

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  vi.stubEnv("APP_URL", "https://concerts.example");
  vi.stubEnv("NODE_ENV", "production");
  resetEnvForTests();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});
beforeEach(() => vi.clearAllMocks());

const del = (cookie?: string) =>
  DELETE(
    new Request("https://concerts.example/api/me", {
      method: "DELETE",
      headers: cookie ? { cookie } : {},
    }),
    {},
  );

describe("DELETE /api/me", () => {
  it("deletes the signed-in user, clears the session cookie and returns 204", async () => {
    const res = await del("session=good");
    expect(res.status).toBe(204);
    expect(service.deleteAccount).toHaveBeenCalledWith("u1");
    expect(res.headers.get("set-cookie")).toBe(
      "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
    );
    expect(await res.text()).toBe("");
  });

  it("returns 401 and deletes nothing without a valid session", async () => {
    expect((await del()).status).toBe(401);
    expect((await del("session=forged")).status).toBe(401);
    expect(service.deleteAccount).not.toHaveBeenCalled();
  });
});
