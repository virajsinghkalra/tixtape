import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { GateSource } from "@/domain/gigs/auto-publish";
import type { ValidatedGig } from "@/domain/gigs/nights";
import type { EventId } from "@/domain/shared/ids";
import { testDb } from "../../../tests/setup/db";
import { PgEventCandidateRepository } from "../db/event-candidate-repository";
import {
  PgArtistMatches,
  PgGateDecisionStore,
  PgGigCandidateReader,
  PgGigLeadStore,
  PgPublishAuditLog,
  PgPublishSwitch,
  PgSearchedTerms,
} from "./pg-gig-stores";

const db = testDb();
afterAll(() => db.$close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE TABLE event_candidates, gate_decisions, publish_audit, gig_leads,
    settings, search_log, artist_aliases, artists, events RESTART IDENTITY CASCADE`);
});

const now = new Date("2026-11-21T10:00:00Z");

/** A real event row (the audit and decision tables reference events). */
async function newEvent(key: string): Promise<EventId> {
  const [venue] = await db.execute<{ id: string }>(sql`
    insert into venues (name, normalized_name, city, country)
    values (${`OML HQ ${key}`}, ${`oml hq ${key}`}, 'Mumbai', 'IN') returning id`);
  const [event] = await db.execute<{ id: string }>(sql`
    insert into events (title, type, venue_id, starts_at, dedupe_key)
    values ('Bhuwin Live in Mumbai', 'concert', ${venue!.id}::uuid, now() + interval '14 days', ${key})
    returning id`);
  return event!.id as EventId;
}

const gig: ValidatedGig = {
  source: "artist_site",
  trust: "official",
  externalId: "artist_site:https://bhuwin.example.com/live#2026-12-05",
  url: "https://bhuwin.example.com/live",
  title: "Bhuwin Live in Mumbai",
  type: "concert",
  startsAt: new Date("2026-12-05T00:00:00+05:30"),
  endsAt: null,
  dateExplicit: true,
  city: "Mumbai",
  country: "IN",
  venueName: null,
  artists: ["Bhuwin"],
  supportActs: [],
  confidence: 0.8,
  provenance: {
    domain: "bhuwin.example.com",
    officialKind: "artist",
    artist: "Bhuwin",
    startTime: "19:30",
    dateOnly: false,
    runNights: ["2026-12-06", "2026-12-09"],
    dateRange: false,
    quotes: { date: "05th, 06th & 09th December 2026", city: "Mumbai | 05th", headliner: "Bhuwin" },
    via: "artist_site",
  },
};

describe("gig candidates in event_candidates (D-073)", () => {
  it("round-trips provenance through the Events team's candidate store", async () => {
    await new PgEventCandidateRepository(db).upsert(
      gig,
      "bhuwin live in mumbai|2026-12-04|mumbai",
      now,
    );
    const [read] = await new PgGigCandidateReader(db).listUpcoming(now, new Date(0));
    expect(read).toMatchObject({ source: "artist_site", provenance: gig.provenance });
    expect(read!.startsAt.toISOString()).toBe(gig.startsAt.toISOString());
  });

  it("drops a row whose provenance is malformed instead of trusting it", async () => {
    await db.execute(sql`insert into event_candidates (dedupe_key, source, external_id, url, payload)
      values ('k', 'gig_web', 'x', 'https://a.example/x', ${JSON.stringify({
        ...gig,
        source: "gig_web",
        startsAt: gig.startsAt.toISOString(),
        provenance: { ...gig.provenance, quotes: "not a record" },
      })}::jsonb)`);
    expect(await new PgGigCandidateReader(db).listUpcoming(now, new Date(0))).toEqual([]);
  });
});

describe("gate_decisions and publish_audit (D-074)", () => {
  it("upserts one verdict per night and keeps a known event id", async () => {
    const store = new PgGateDecisionStore(db);
    const ev = await newEvent("k1");
    const record = {
      nightKey: "2026-12-05|mumbai|bhuwin",
      title: "Bhuwin Live in Mumbai",
      night: "2026-12-05",
      city: "Mumbai",
      headliner: "Bhuwin",
      decision: "publish" as const,
      reasons: [],
      checks: [{ rule: "confidence" as const, ok: true, detail: "0.92" }],
      sources: [
        {
          source: "artist_site",
          url: gig.url,
          domain: "bhuwin.example.com",
          officialKind: "artist" as const,
        },
      ],
      confidence: 0.92,
      eventId: ev,
      decidedAt: now,
    };
    await store.save(record);
    await store.save({ ...record, decision: "hold", reasons: ["confidence: 0.8"], eventId: null });
    const got = await store.get(record.nightKey);
    expect(got).toMatchObject({ decision: "hold", reasons: ["confidence: 0.8"], eventId: ev });
  });

  it("lists auto-published events due for re-verification from the append-only log", async () => {
    const audit = new PgPublishAuditLog(db);
    const source: GateSource = {
      url: gig.url,
      domain: "bhuwin.example.com",
      officialKind: "artist",
      title: gig.title,
      night: "2026-12-05",
      startTime: "19:30",
      dateOnly: false,
      dateRange: false,
      city: "Mumbai",
      artists: ["Bhuwin"],
      quotes: { date: "5 December 2026" },
      cancelled: false,
    };
    const ids = [await newEvent("a"), await newEvent("b"), await newEvent("c")];
    const entry = (eventId: EventId, action: "published" | "held" | "reverified", at: Date) => ({
      eventId,
      nightKey: "k",
      action,
      actor: "auto-gate" as const,
      reasons: [],
      sources: [source],
      changes: null,
      at,
    });
    const old = new Date(now.getTime() - 4 * 86_400_000);
    await audit.append(entry(ids[0]!, "published", old)); // due
    await audit.append(entry(ids[1]!, "published", old));
    await audit.append(entry(ids[1]!, "held", now)); // held since: not due
    await audit.append(entry(ids[2]!, "reverified", now)); // checked just now: not due
    const due = await audit.dueForReverification(new Date(now.getTime() - 3 * 86_400_000));
    expect(due.map((d) => d.eventId)).toEqual([ids[0]]);
    expect(due[0]!.sources[0]).toMatchObject({ url: gig.url, startTime: "19:30" });
  });
});

describe("leads, matches, searched terms and the publish switch", () => {
  it("upserts leads on URL", async () => {
    const leads = new PgGigLeadStore(db);
    const lead = {
      artist: "Bhuwin",
      url: "https://in.bookmyshow.com/events/sketchbook-by-bhuwin-khursija/et9ppluaao",
      domain: "bookmyshow.com",
      title: "Sketchbook by Bhuwin Khursija",
      reason: "denied_domain" as const,
    };
    await leads.upsert(lead, now);
    await leads.upsert(
      { ...lead, title: "Sketchbook by Bhuwin Khursija · Mumbai" },
      new Date(now.getTime() + 1000),
    );
    const rows = await db.execute<{ title: string }>(sql`select title from gig_leads`);
    expect(rows.map((r) => r.title)).toEqual(["Sketchbook by Bhuwin Khursija · Mumbai"]);
  });

  it("prefers a confident match over a pending duplicate", async () => {
    await db.execute(sql`insert into artists (name, normalized_name, spotify_id, match_status) values
      ('Bhuwin', 'bhuwin', null, 'pending'), ('Bhuwin', 'bhuwin', '6vsLn0UxL3GhtYP7ghpF3t', 'auto')`);
    expect(await new PgArtistMatches(db).statusOf("BHUWIN")).toEqual({
      spotifyId: "6vsLn0UxL3GhtYP7ghpF3t",
      matchStatus: "auto",
    });
    expect(await new PgArtistMatches(db).statusOf("nobody")).toBeNull();
  });

  it("counts recent searched terms", async () => {
    await db.execute(sql`insert into search_log (query_normalized, results_count, created_at) values
      ('bhuwin', 0, ${now.toISOString()}::timestamptz), ('bhuwin', 1, ${now.toISOString()}::timestamptz),
      ('ab', 0, ${now.toISOString()}::timestamptz)`);
    // Only searches that found nothing count (the D-050 watch list).
    expect(await new PgSearchedTerms(db).recent(new Date(0), 10)).toEqual([
      { term: "bhuwin", count: 1 },
    ]);
  });

  it("is closed unless enabled and not paused; an unreadable pause fails closed", async () => {
    expect(await new PgPublishSwitch(db, false).blockedReason(now)).toMatch(
      /AUTO_PUBLISH_ENABLED/u,
    );
    const on = new PgPublishSwitch(db, true);
    expect(await on.blockedReason(now)).toBeNull();
    await db.execute(
      sql`insert into settings (key, value) values ('auto_publish_paused_until', ${JSON.stringify("2026-11-22T00:00:00Z")}::jsonb)`,
    );
    expect(await on.blockedReason(now)).toMatch(/paused until/u);
    expect(await on.blockedReason(new Date("2026-11-23T00:00:00Z"))).toBeNull();
    await db.execute(sql`update settings set value = '"tomorrow"'::jsonb`);
    expect(await on.blockedReason(now)).toMatch(/unreadable/u);
  });
});
