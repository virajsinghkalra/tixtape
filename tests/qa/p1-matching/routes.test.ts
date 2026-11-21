import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMatchingModule, type MatchingModule } from "@/application/matching";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { FakeArtistRepo, FakeCatalog, NOW, cand, fixedClock, sid } from "./fakes";

const state = vi.hoisted(() => ({
  role: "admin" as "admin" | "user" | "anon",
  module: null as unknown,
}));

vi.mock("@/server/auth/guards", () => ({
  requireUser: vi.fn(),
  requireAdmin: vi.fn(async () => {
    if (state.role === "anon") throw new UnauthorizedError("no");
    if (state.role === "user") throw new ForbiddenError("no");
    return { id: "u1", spotifyUserId: "s", displayName: null, market: "IN", role: "admin" };
  }),
}));
vi.mock("@/server/matching", () => ({ matching: () => state.module as MatchingModule }));

const { GET } = await import("@/app/api/admin/artists/route");
const { PATCH } = await import("@/app/api/admin/artists/[id]/route");

let artists: FakeArtistRepo;
let catalog: FakeCatalog;

beforeEach(() => {
  state.role = "admin";
  artists = new FakeArtistRepo();
  catalog = new FakeCatalog(() => [cand("Daft Punk", 0), cand("Daft Punk", 1)]);
  state.module = createMatchingModule({
    catalog,
    artists,
    clock: fixedClock(),
    tracks: {
      searchTracks: async () => [],
      getArtistAlbums: async () => [],
      getAlbumTracks: async () => [],
    },
  });
});

const base = "http://localhost/api/admin/artists";
const get = (qs: string) => GET(new Request(`${base}${qs}`), undefined as never);
const patch = (id: string, body: unknown, raw = false) =>
  PATCH(
    new Request(`${base}/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );

const VALID_SID = "4tZwfgrHOc3mvqYlEYSvVi";
const GHOST = "11111111-1111-4111-8111-111111111111";

async function reviewArtist() {
  const a = artists.seed("Daft Punk", normalizeArtistName("Daft Punk"));
  await (state.module as MatchingModule).resolveArtist(a);
  return a;
}

describe("QA GET /api/admin/artists", () => {
  it("lists the review queue for admins", async () => {
    const a = await reviewArtist();
    const res = await get("?status=needs_review&limit=10");
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain(a.id);
  });

  it.each([
    ["anon", 401],
    ["user", 403],
  ] as const)("%s -> %i", async (role, code) => {
    state.role = role;
    expect((await get("?status=needs_review&limit=10")).status).toBe(code);
  });

  it.each([
    "?status=needs_review&limit=0",
    "?status=needs_review&limit=101",
    "?status=needs_review&limit=-1",
    "?status=needs_review&limit=1e9",
    "?status=needs_review&limit=abc",
    "?status=needs_review&limit=2.5",
    "?status=auto&limit=10",
    "?status=DROP%20TABLE&limit=10",
  ])("bad query %s -> 400", async (qs) => {
    expect((await get(qs)).status).toBe(400);
  });

  it.each(["?status=needs_review&limit=1", "?status=needs_review&limit=100"])(
    "boundary %s -> 200",
    async (qs) => {
      expect((await get(qs)).status).toBe(200);
    },
  );
});

describe("QA PATCH /api/admin/artists/:id", () => {
  it("approve -> 200, artist manual with alias", async () => {
    const a = await reviewArtist();
    const res = await patch(a.id, { action: "approve", spotifyArtistId: VALID_SID });
    expect(res.status).toBe(200);
    const row = await artists.findById(a.id);
    expect(row?.matchStatus).toBe("manual");
    expect(row?.spotifyId).toBe(VALID_SID);
    expect(row?.spotifyResolvedAt?.getTime()).toBe(NOW.getTime());
  });

  it("not_found -> 200", async () => {
    const a = await reviewArtist();
    expect((await patch(a.id, { action: "not_found" })).status).toBe(200);
    expect((await artists.findById(a.id))?.matchStatus).toBe("not_found");
  });

  it.each([
    ["anon", 401],
    ["user", 403],
  ] as const)("%s -> %i and nothing changes", async (role, code) => {
    const a = await reviewArtist();
    state.role = role;
    expect((await patch(a.id, { action: "not_found" })).status).toBe(code);
    expect((await artists.findById(a.id))?.matchStatus).toBe("needs_review");
  });

  it("unknown artist -> 404", async () => {
    expect((await patch(GHOST, { action: "not_found" })).status).toBe(404);
    expect((await patch(GHOST, { action: "approve", spotifyArtistId: VALID_SID })).status).toBe(
      404,
    );
  });

  it.each([
    ["not-a-uuid", { action: "not_found" }],
    ["", { action: "not_found" }],
    ["11111111-1111-4111-8111-11111111111", { action: "not_found" }],
    ["../../etc/passwd", { action: "not_found" }],
  ])("invalid id %j -> 400", async (id, body) => {
    expect((await patch(id, body)).status).toBe(400);
  });

  it.each([
    [{ action: "delete" }],
    [{}],
    [null],
    [[]],
    ["approve"],
    [{ action: "approve" }],
    [{ action: "approve", spotifyArtistId: "short" }],
    [{ action: "approve", spotifyArtistId: "4tZwfgrHOc3mvqYlEYSvV!" }],
    [{ action: "approve", spotifyArtistId: "4tZwfgrHOc3mvqYlEYSvVii" }],
    [{ action: "approve", spotifyArtistId: `${VALID_SID} ` }],
    [{ action: "approve", spotifyArtistId: 1234567890123456789012 }],
    [{ action: "APPROVE", spotifyArtistId: VALID_SID }],
  ])("bad body %j -> 400", async (body) => {
    const a = await reviewArtist();
    const res = await patch(a.id, body);
    expect(res.status).toBe(400);
    expect((await artists.findById(a.id))?.matchStatus).toBe("needs_review");
  });

  // AMBIGUOUS: LLD §9 says "Zod-validated" but not whether unknown keys are rejected (strict) or stripped.
  it.each([
    [{ action: "not_found", spotifyArtistId: VALID_SID }],
    [{ action: "approve", spotifyArtistId: VALID_SID, matchStatus: "auto" }],
  ])("body with extra fields %j -> 400", async (body) => {
    const a = await reviewArtist();
    expect((await patch(a.id, body)).status).toBe(400);
  });

  it.each(["{not json", "", "undefined", '{"action":"not_found"'])(
    "non-JSON body %j -> 400",
    async (raw) => {
      const a = await reviewArtist();
      expect((await patch(a.id, raw, true)).status).toBe(400);
    },
  );

  it("approving a Spotify ID held by another artist -> 409, not 500", async () => {
    const holder = artists.seed("Other Artist", "other artist", {
      matchStatus: "manual",
      spotifyId: sid(VALID_SID),
    });
    const a = await reviewArtist();
    const res = await patch(a.id, { action: "approve", spotifyArtistId: holder.spotifyId });
    expect([400, 409]).toContain(res.status);
    expect((await artists.findById(a.id))?.matchStatus).toBe("needs_review");
  });

  it("approving when the alias belongs to another artist -> 409, not 500", async () => {
    const other = artists.seed("Daft Punk Old", "daft punk old", { matchStatus: "manual" });
    await artists.addAlias(other.id, normalizeArtistName("Daft Punk"));
    const a = await reviewArtist();
    const res = await patch(a.id, { action: "approve", spotifyArtistId: VALID_SID });
    expect([400, 409]).toContain(res.status);
  });

  it("re-approving the same artist with the same ID is idempotent (200)", async () => {
    const a = await reviewArtist();
    expect((await patch(a.id, { action: "approve", spotifyArtistId: VALID_SID })).status).toBe(200);
    expect((await patch(a.id, { action: "approve", spotifyArtistId: VALID_SID })).status).toBe(200);
  });
});
