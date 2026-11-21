import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/application/auth/ports";
import { asUserId } from "@/domain/shared/ids";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { requireAdmin, requireUser } from "./guards";

const sessions: Record<string, AuthUser> = {
  "user-session": {
    id: asUserId("u1"),
    spotifyUserId: "sp1",
    displayName: null,
    market: "IN",
    role: "user",
  },
  "admin-session": {
    id: asUserId("u2"),
    spotifyUserId: "sp2",
    displayName: "Ada",
    market: "IN",
    role: "admin",
  },
};
const getSessionUser = vi.fn(async (id: string) => sessions[id] ?? null);
vi.mock("./spotify-auth", () => ({ authService: () => ({ getSessionUser }) }));

const req = (cookie?: string) =>
  new Request("http://127.0.0.1/api/x", cookie ? { headers: { cookie } } : undefined);

describe("guards", () => {
  it("requireUser returns the session's user", async () => {
    await expect(requireUser(req("session=user-session"))).resolves.toEqual(
      sessions["user-session"],
    );
  });

  it("requireUser throws 401 without a cookie or with an unknown session", async () => {
    getSessionUser.mockClear();
    await expect(requireUser(req())).rejects.toBeInstanceOf(UnauthorizedError);
    expect(getSessionUser).not.toHaveBeenCalled();
    await expect(requireUser(req("session=forged"))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireAdmin allows admins and gives others 403", async () => {
    await expect(requireAdmin(req("session=admin-session"))).resolves.toMatchObject({
      role: "admin",
    });
    await expect(requireAdmin(req("session=user-session"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireAdmin(req())).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
