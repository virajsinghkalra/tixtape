import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as PlaylistsServer from "@/server/playlists";
import { PUBLISHER_ID, playlistWorld } from "@/application/playlists/testing/fakes";
import { asUserId } from "@/domain/shared/ids";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

const guard = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const wired = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/auth/guards", () => guard);
vi.mock("@/server/playlists", async (importOriginal) => ({
  ...(await importOriginal<typeof PlaylistsServer>()),
  playlists: () => wired.current,
}));

const { GET, POST } = await import("./route");

const ADMIN = asUserId("22222222-2222-4222-8222-222222222222");
let w: ReturnType<typeof playlistWorld>;

beforeEach(() => {
  w = playlistWorld();
  wired.current = w.useCases;
  guard.requireAdmin.mockResolvedValue({ id: ADMIN, role: "admin" });
});

const req = (method: string, body?: string) => new Request("http://x", { method, body });

describe("/api/admin/publisher", () => {
  it("GET reports the connected publisher", async () => {
    const res = await GET(req("GET"), undefined);
    expect(await res.json()).toEqual({
      connected: true,
      displayName: "Tixtape",
      needsReauth: false,
    });
  });

  it("GET reports needs-reauth and not-connected", async () => {
    w.tokens.add(PUBLISHER_ID, true);
    expect(await (await GET(req("GET"), undefined)).json()).toMatchObject({ needsReauth: true });
    w.publisher.row = null;
    expect(await (await GET(req("GET"), undefined)).json()).toEqual({
      connected: false,
      displayName: null,
      needsReauth: false,
    });
  });

  it("POST makes the signed-in admin the publisher", async () => {
    w.tokens.add(ADMIN);
    const res = await POST(req("POST"), undefined);
    expect(res.status).toBe(200);
    expect(w.publisher.row?.userId).toBe(ADMIN);
    expect(await res.json()).toMatchObject({ connected: true, needsReauth: false });
  });

  it("POST 409s when the admin's Spotify sign-in needs renewing", async () => {
    w.tokens.add(ADMIN, true);
    expect((await POST(req("POST", "{}"), undefined)).status).toBe(409);
    expect(w.publisher.row?.userId).toBe(PUBLISHER_ID);
  });

  it("POST 400s a body with unknown keys", async () => {
    w.tokens.add(ADMIN);
    expect((await POST(req("POST", '{"userId":"someone"}'), undefined)).status).toBe(400);
    expect(w.publisher.row?.userId).toBe(PUBLISHER_ID);
  });

  it.each([
    [new UnauthorizedError("Sign in"), 401],
    [new ForbiddenError("Admins only"), 403],
  ])("enforces admin: %s", async (error, status) => {
    guard.requireAdmin.mockRejectedValue(error);
    expect((await GET(req("GET"), undefined)).status).toBe(status);
    expect((await POST(req("POST"), undefined)).status).toBe(status);
  });
});
