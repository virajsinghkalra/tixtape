import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { recordBeacon } from "@/application/analytics";
import { analyticsEvents, devices, people } from "@/db/schema";
import type { AnalyticsEvent } from "@/domain/analytics/beacon";
import { CONSENT_VERSION } from "@/domain/analytics/identity";
import { InMemoryRateLimiter } from "@/infrastructure/in-memory-rate-limiter";
import { testDb, truncateAll } from "../../../tests/setup/db";
import { PgAnalyticsDashboard } from "./analytics-dashboard";
import { PgAnalyticsStore } from "./analytics-store";

const db = testDb();
const store = new PgAnalyticsStore(db);
const dashboard = new PgAnalyticsDashboard(db);
const NOW = new Date("2026-11-22T06:30:00Z"); // 12:00 IST
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY);
const direct = { source: "direct", medium: null, campaign: null };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1";

const record = (
  deviceId: string,
  events: AnalyticsEvent[],
  when = NOW,
  extra: { source?: string; city?: string | null } = {},
) =>
  store.record(
    {
      deviceId,
      source: { ...direct, source: extra.source ?? "direct" },
      city: extra.city ?? null,
      at: when,
    },
    events,
  );

const contact = (email: string, personName: string | null = null) => ({
  email,
  personName,
  source: "ping_me" as const,
  consentVersion: CONSENT_VERSION,
});

beforeEach(() => truncateAll(db));
afterAll(() => db.$close());

describe("PgAnalyticsStore (D-090)", () => {
  it("creates a device once, keeps its first source and moves last_seen forward only", async () => {
    const did = randomUUID();
    await record(did, [{ n: "page_view", p: { path: "home" } }], at(2), { source: "whatsapp" });
    await record(did, [{ n: "page_view", p: { path: "event" } }], NOW, { source: "google" });
    await record(did, [{ n: "install", p: {} }], at(5), { source: "other" });
    const [d] = await db.select().from(devices).where(eq(devices.id, did));
    expect(d?.firstSource).toBe("whatsapp");
    expect(d?.firstSeen).toEqual(at(2));
    expect(d?.lastSeen).toEqual(NOW);
    const rows = await db.select().from(analyticsEvents);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.source).sort()).toEqual(["google", "other", "whatsapp"]);
  });

  it("drops bots, DNT/GPC and busy clients before storing (recordBeacon)", async () => {
    const deps = { store, limiter: new InMemoryRateLimiter(1, 60_000) };
    const base = {
      beacon: { did: randomUUID(), ev: [{ n: "install" as const, p: {} }] },
      userAgent: UA,
      optedOut: false,
      clientKey: "k",
      city: "Mumbai",
      selfHost: "tixtape.vercel.app",
      now: NOW,
    };
    expect(await recordBeacon(deps, { ...base, optedOut: true })).toBe("opted_out");
    expect(
      await recordBeacon(deps, { ...base, userAgent: "Googlebot/2.1 (+http://google.com)" }),
    ).toBe("bot");
    expect(await recordBeacon(deps, base)).toBe("stored");
    expect(await recordBeacon(deps, base)).toBe("limited");
    const rows = await db.select().from(analyticsEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.city).toBe("Mumbai");
  });

  it("sets a nickname on a new person, then updates it", async () => {
    const did = randomUUID();
    await store.setNickname(did, "Vee", NOW);
    await store.setNickname(did, "Viraj", NOW);
    const all = await db.select().from(people);
    expect(all).toHaveLength(1);
    expect(all[0]?.nickname).toBe("Viraj");
    const [d] = await db.select().from(devices).where(eq(devices.id, did));
    expect(d?.personId).toBe(all[0]?.id);
  });

  it("adds an email with consent to the device's person, linking its anonymous history", async () => {
    const did = randomUUID();
    await record(did, [{ n: "search", p: { q: "coldplay", results: 2 } }], at(1));
    await store.setNickname(did, "Vee", NOW);
    expect(await store.saveContact(did, contact("vee@example.com", "Viraj"), NOW)).toBe("saved");
    const [p] = await db.select().from(people);
    expect(p).toMatchObject({
      nickname: "Vee",
      name: "Viraj",
      email: "vee@example.com",
      consentVersion: CONSENT_VERSION,
      consentSource: "ping_me",
    });
    expect(p?.consentAt).toEqual(NOW);
    const found = await dashboard.person(p!.id);
    expect(found?.timeline.map((t) => t.name)).toEqual(["search"]);
  });

  it("never links or changes an email another device already holds", async () => {
    const owner = randomUUID();
    const other = randomUUID();
    await store.saveContact(owner, contact("a@example.com", "Asha"), at(1));
    expect(await store.saveContact(other, contact("a@example.com", "Mallory"), NOW)).toBe("kept");
    const all = await db.select().from(people);
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("Asha");
    expect(all[0]?.consentAt).toEqual(at(1));
    const [d] = await db.select().from(devices).where(eq(devices.id, other));
    expect(d?.personId).toBeNull();
    // …so the other device can't delete Asha either.
    await store.deleteDeviceData(other);
    expect(await db.select().from(people)).toHaveLength(1);
  });

  it("is safe under a double submit of the same email", async () => {
    const did = randomUUID();
    await Promise.all([
      store.saveContact(did, contact("b@example.com"), NOW),
      store.saveContact(did, contact("b@example.com"), NOW),
    ]);
    expect(await db.select().from(people)).toHaveLength(1);
  });

  it("delete removes the person and devices and anonymises (not deletes) their events", async () => {
    const did = randomUUID();
    const stranger = randomUUID();
    await record(did, [{ n: "event_open", p: { eventId: randomUUID() } }], at(1));
    await record(stranger, [{ n: "page_view", p: { path: "home" } }], at(1));
    await store.saveContact(did, contact("c@example.com", "Chirag"), NOW);
    const r = await store.deleteDeviceData(did);
    expect(r).toEqual({ person: true, events: 1 });
    expect(await db.select().from(people)).toHaveLength(0);
    expect((await db.select().from(devices)).map((d) => d.id)).toEqual([stranger]);
    const events = await db.select().from(analyticsEvents);
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.deviceId === null).map((e) => e.name)).toEqual(["event_open"]);
  });

  it("delete of an anonymous or unknown device is harmless", async () => {
    const did = randomUUID();
    await record(did, [{ n: "install", p: {} }]);
    expect(await store.deleteDeviceData(did)).toEqual({ person: false, events: 1 });
    expect(await store.deleteDeviceData(randomUUID())).toEqual({ person: false, events: 0 });
  });

  it("prunes events older than the cut-off and idle anonymous devices, never people", async () => {
    const old = randomUUID();
    const named = randomUUID();
    await record(old, [{ n: "install", p: {} }], at(200));
    await record(named, [{ n: "install", p: {} }], at(200));
    await store.setNickname(named, "Old friend", at(200));
    await db
      .update(devices)
      .set({ lastSeen: at(200) })
      .where(eq(devices.id, named));
    await record(randomUUID(), [{ n: "install", p: {} }], at(10));
    expect(await store.prune(at(180))).toEqual({ events: 2, devices: 1 });
    expect(await db.select().from(analyticsEvents)).toHaveLength(1);
    expect(await db.select().from(people)).toHaveLength(1);
  });
});

describe("PgAnalyticsDashboard (D-090)", () => {
  it("counts active devices, new vs returning, the daily line, funnel and top lists", async () => {
    const eventId = randomUUID();
    const artistId = randomUUID();
    await db.execute(sql`
      insert into events (id, title, type, starts_at, dedupe_key)
      values (${eventId}, 'Coldplay Live', 'concert', now(), 'k1')`);
    await db.execute(sql`
      insert into artists (id, name, normalized_name) values (${artistId}, 'Coldplay', 'coldplay')`);
    await db.execute(sql`
      insert into event_artists (event_id, artist_id, billing_rank, tier)
      values (${eventId}, ${artistId}, 1, 'headliner')`);
    const a = randomUUID(); // new today, from WhatsApp
    const b = randomUUID(); // returning: first seen 20 days ago
    const c = randomUUID(); // only 10 days ago
    await record(
      a,
      [
        { n: "page_view", p: { path: "home" } },
        { n: "search", p: { q: "Coldplay", results: 0 } },
        { n: "search", p: { q: "coldplay", results: 0 } },
        { n: "event_open", p: { eventId } },
        { n: "playlist_make", p: { eventId } },
        { n: "share", p: { channel: "native", eventId } },
        { n: "ping_me", p: { artist: "Coldplay" } },
      ],
      NOW,
      { source: "whatsapp", city: "Mumbai" },
    );
    await record(b, [{ n: "page_view", p: { path: "home" } }], at(20), { source: "google" });
    await record(
      b,
      [
        { n: "page_view", p: { path: "event" } },
        { n: "event_open", p: { eventId } },
      ],
      at(0.5),
      { city: "Pune" },
    );
    await record(c, [{ n: "page_view", p: { path: "home" } }], at(10));
    await store.setNickname(b, "Bee", at(0.5));

    const d = await dashboard.dashboard(NOW);
    expect(d.overview).toMatchObject({
      dau: 2,
      wau: 2,
      mau: 3,
      newDevices: 1,
      returningDevices: 1,
    });
    expect(d.overview.daily).toHaveLength(30);
    expect(d.overview.daily.at(-1)).toEqual({ day: "2026-11-22", devices: 2 });
    expect(d.overview.daily.reduce((s, x) => s + x.devices, 0)).toBe(4);
    expect(d.funnel).toEqual([
      { step: "Visit", devices: 3 },
      { step: "Search", devices: 1 },
      { step: "Event open", devices: 2 },
      { step: "Playlist", devices: 1 },
    ]);
    expect(d.top.events).toEqual([{ eventId, title: "Coldplay Live", opens: 2 }]);
    expect(d.top.artists).toEqual([{ key: "Coldplay", count: 2 }]);
    expect(d.top.searches).toEqual([{ query: "coldplay", count: 2, results: 0 }]);
    expect(d.top.zeroResults).toEqual([{ key: "coldplay", count: 2 }]);
    expect(d.top.wanted).toEqual([{ key: "Coldplay", count: 1 }]);
    expect(d.top.cities).toEqual([
      { key: "Mumbai", count: 1 },
      { key: "Pune", count: 1 },
    ]);
    expect(d.top.sources).toEqual([
      { key: "direct", count: 1 },
      { key: "google", count: 1 },
      { key: "whatsapp", count: 1 },
    ]);
    expect(d.top.shares).toEqual([{ key: "native", count: 1 }]);
    expect(d.people.map((p) => p.nickname)).toEqual(["Bee"]);
    expect(d.people[0]).toMatchObject({ source: "google", devices: 1, events: 3 });
    expect(d.anonymousDevices).toBe(2);
  });

  it("returns null for an unknown or malformed person id", async () => {
    expect(await dashboard.person(randomUUID())).toBeNull();
    expect(await dashboard.person("1; drop table people")).toBeNull();
  });
});
