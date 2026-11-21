import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventsUseCases } from "@/application/events";
import { fakeEventsWorld } from "@/application/events/testing/fakes";
import { UnauthorizedError } from "@/lib/errors";

const guard = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const wired = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/server/auth/guards", () => guard);
vi.mock("@/server/events", () => ({ events: () => wired.current }));

const { GET: list, POST } = await import("./route");
const { GET: getOne, PATCH } = await import("./[id]/route");

beforeEach(() => {
  guard.requireAdmin.mockReset().mockResolvedValue({ role: "admin" });
  wired.current = createEventsUseCases({
    ...fakeEventsWorld(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
});

const body = {
  title: "Sunburn Festival 2026",
  type: "festival",
  startsAt: "2026-12-28T15:00:00+05:30",
  venue: { name: "Vagator Beach", city: "Goa", country: "IN" },
  lineup: [
    { name: "Martin Garrix", tier: "headliner" },
    { name: "Zaeden", tier: "support", day: 2, stage: "Main" },
  ],
};
const post = (b: unknown) =>
  POST(
    new Request("http://x/api/admin/events", { method: "POST", body: JSON.stringify(b) }),
    undefined,
  );
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("admin event routes", () => {
  it("POST creates (201), and a matching second POST merges (200)", async () => {
    const first = await post(body);
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({
      outcome: "created",
      event: { title: "Sunburn Festival 2026", venue: { city: "Goa" }, artistCount: 2 },
    });
    const second = await post({ ...body, title: "Sunburn Festival" });
    expect(second.status).toBe(200);
    expect((await second.json()).event.id).toBe(created.event.id);
  });

  it.each([
    ["empty lineup", { ...body, lineup: [] }],
    ["missing venue", { ...body, venue: undefined }],
    ["bad date", { ...body, startsAt: "28-12-2026" }],
  ])("POST 400s on %s", async (_label, b) => {
    const res = await post(b);
    expect(res.status).toBe(400);
    expect((await res.json()).error.issues.length).toBeGreaterThan(0);
  });

  it("POST 400s invalid JSON", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: "{" }), undefined);
    expect(res.status).toBe(400);
  });

  it("GET and PATCH by id", async () => {
    const { event } = await (await post(body)).json();
    const got = await getOne(new Request("http://x"), ctx(event.id));
    expect((await got.json()).event.sources).toEqual([
      expect.objectContaining({ source: "admin", externalId: event.id }),
    ]);

    const patched = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "full_lineup" }) }),
      ctx(event.id),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).event).toMatchObject({ status: "full_lineup", artistCount: 2 });
  });

  it("POST creates held by default and published only when asked (D-056)", async () => {
    expect((await (await post(body)).json()).event.visibility).toBe("held");
    const other = await post({
      ...body,
      title: "Hornbill Festival",
      startsAt: "2027-12-01T15:00:00+05:30",
      visibility: "published",
    });
    expect((await other.json()).event.visibility).toBe("published");
    expect((await post({ ...body, title: "X Fest", visibility: "secret" })).status).toBe(400);
  });

  it.each(["published", "archived", "held"])(
    "PATCH {visibility: %j} changes only visibility",
    async (visibility) => {
      const { event } = await (await post(body)).json();
      const res = await PATCH(
        new Request("http://x", { method: "PATCH", body: JSON.stringify({ visibility }) }),
        ctx(event.id),
      );
      expect(res.status).toBe(200);
      const updated = (await res.json()).event;
      expect(updated).toMatchObject({
        visibility,
        title: event.title,
        lineupHash: event.lineupHash,
      });
      const got = await (await getOne(new Request("http://x"), ctx(event.id))).json();
      expect(got.event.visibility).toBe(visibility);
    },
  );

  it("a visibility-only PATCH adds no admin source row (QA-E-7)", async () => {
    const { event } = await (await post(body)).json();
    const before = event.sources;
    await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ visibility: "published" }),
      }),
      ctx(event.id),
    );
    const got = await (await getOne(new Request("http://x"), ctx(event.id))).json();
    expect(got.event.sources).toEqual(before);
  });

  it("GET list shows every visibility with the admin fields, and filters by one", async () => {
    await post(body);
    await post({
      ...body,
      title: "Hornbill Festival",
      startsAt: "2027-12-01T15:00:00+05:30",
      visibility: "published",
    });
    const all = await (await list(new Request("http://x/api/admin/events"), undefined)).json();
    expect(all.events.map((e: { visibility: string }) => e.visibility).sort()).toEqual([
      "held",
      "published",
    ]);
    expect(all.events[0]).toHaveProperty("confidence");
    const held = await (
      await list(new Request("http://x/api/admin/events?visibility=held"), undefined)
    ).json();
    expect(held.total).toBe(1);
  });

  it("PATCH 404s an unknown id before reading the body", async () => {
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: "{}" }),
      ctx("bad-id"),
    );
    expect(res.status).toBe(404);
  });

  it("GET list returns the paginated shape", async () => {
    await post(body);
    const res = await list(new Request("http://x/api/admin/events?q=sunburn"), undefined);
    expect(await res.json()).toMatchObject({ total: 1, page: 1, pageSize: 20 });
  });

  it.each([
    ["GET list", () => list(new Request("http://x/api/admin/events"), undefined)],
    ["POST", () => post(body)],
    ["GET one", () => getOne(new Request("http://x"), ctx("x"))],
    ["PATCH", () => PATCH(new Request("http://x", { method: "PATCH", body: "{}" }), ctx("x"))],
  ])("%s returns the guard's 401", async (_label, call) => {
    guard.requireAdmin.mockRejectedValue(
      new UnauthorizedError("Sign in with Spotify to continue."),
    );
    const res = await call();
    expect(res.status).toBe(401);
  });
});
