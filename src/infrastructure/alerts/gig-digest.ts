/**
 * D-073/D-074 operator views for alerts: the daily Gig Coverage digest and the auto-publish
 * spike count. Read-only queries over the Gig Coverage audit tables, plus pure formatting.
 * JSON columns are validated here (ENGINEERING.md §3); anything unreadable is shown as "?".
 */
import { and, desc, eq, gt, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Alert } from "@/application/ports/alerts";
import type { Database } from "@/db/client";
import { events, gateDecisions, gigLeads, publishAudit, venues } from "@/db/schema";

/** D-074: the scheduled gate's actor name in `publish_audit`. */
export const AUTO_GATE_ACTOR = "auto-gate";
/** More auto-published events than this in 24 h pauses auto-publish (D-074 safety valve). */
export const AUTO_PUBLISH_SPIKE_LIMIT = 30;
const LIST_LIMIT = 50;

const Sources = z.array(z.object({ url: z.string(), domain: z.string() }).loose()).catch([]);
const Reasons = z.array(z.string()).catch([]);
const Changes = z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).nullable();

export type DigestEvent = {
  title: string;
  night: string;
  city: string;
  sources: { url: string; domain: string }[];
};
export type GigActivity = {
  published: DigestEvent[];
  heldOrRejected: (DigestEvent & { decision: string; reasons: string[] })[];
  reverified: {
    title: string;
    action: string;
    reasons: string[];
    changes: Record<string, { from: unknown; to: unknown }> | null;
  }[];
  newLeads: { artist: string; domain: string; url: string; reason: string }[];
};

/** Events the auto-gate published since `since` (the spike guard). */
export async function countAutoPublished(db: Database, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(publishAudit)
    .where(
      and(
        eq(publishAudit.action, "published"),
        eq(publishAudit.actor, AUTO_GATE_ACTOR),
        gt(publishAudit.at, since),
      ),
    );
  return row?.n ?? 0;
}

/** Audit rows with their event's title, date and city; `night_key` labels a deleted event. */
const auditRows = (db: Database, where: SQL | undefined) =>
  db
    .select({
      nightKey: publishAudit.nightKey,
      action: publishAudit.action,
      reasons: publishAudit.reasons,
      sources: publishAudit.sources,
      changes: publishAudit.changes,
      title: events.title,
      startsAt: events.startsAt,
      city: venues.city,
    })
    .from(publishAudit)
    .leftJoin(events, eq(events.id, publishAudit.eventId))
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(where)
    .orderBy(desc(publishAudit.at))
    .limit(LIST_LIMIT);

export async function loadGigActivity(db: Database, since: Date): Promise<GigActivity> {
  const [published, decided, reverified, leads] = await Promise.all([
    auditRows(
      db,
      and(
        eq(publishAudit.action, "published"),
        eq(publishAudit.actor, AUTO_GATE_ACTOR),
        gt(publishAudit.at, since),
      ),
    ),
    db
      .select()
      .from(gateDecisions)
      .where(
        and(
          inArray(gateDecisions.decision, ["hold", "reject"]),
          gt(gateDecisions.decidedAt, since),
        ),
      )
      .orderBy(desc(gateDecisions.decidedAt))
      .limit(LIST_LIMIT),
    auditRows(
      db,
      and(
        inArray(publishAudit.action, ["updated", "held", "reverified"]),
        gt(publishAudit.at, since),
      ),
    ),
    db
      .select()
      .from(gigLeads)
      .where(gt(gigLeads.firstSeenAt, since))
      .orderBy(desc(gigLeads.firstSeenAt))
      .limit(LIST_LIMIT),
  ]);
  return {
    published: published.map((r) => ({
      title: r.title ?? r.nightKey,
      night: r.startsAt ? r.startsAt.toISOString().slice(0, 10) : "?",
      city: r.city ?? "?",
      sources: Sources.parse(r.sources),
    })),
    heldOrRejected: decided.map((d) => ({
      title: d.title,
      night: d.night,
      city: d.city,
      sources: Sources.parse(d.sources),
      decision: d.decision,
      reasons: Reasons.parse(d.reasons),
    })),
    reverified: reverified.map((r) => ({
      title: r.title ?? r.nightKey,
      action: r.action,
      reasons: Reasons.parse(r.reasons),
      changes: Changes.catch(null).parse(r.changes),
    })),
    newLeads: leads.map((l) => ({
      artist: l.artist,
      domain: l.domain,
      url: l.url,
      reason: l.reason,
    })),
  };
}

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
const sourceList = (s: DigestEvent["sources"]) =>
  s.length === 0 ? "no sources recorded" : s.map((x) => `${x.domain} <${x.url}>`).join(", ");

/** The digest alert, or null when there's nothing to report. Pure. */
export function formatGigDigest(a: GigActivity, since: Date, now: Date): Alert | null {
  const total =
    a.published.length + a.heldOrRejected.length + a.reverified.length + a.newLeads.length;
  if (total === 0) return null;
  const parts: string[] = [
    `Gig Coverage, ${since.toISOString().slice(0, 16)}Z to ${now.toISOString().slice(0, 16)}Z.`,
  ];
  if (a.published.length > 0) {
    parts.push(
      `AUTO-PUBLISHED (${a.published.length}):`,
      ...a.published.map(
        (e) => `- ${e.title} | ${e.night} | ${e.city}\n  sources: ${sourceList(e.sources)}`,
      ),
    );
  }
  if (a.heldOrRejected.length > 0) {
    parts.push(
      `HELD OR REJECTED (${a.heldOrRejected.length}):`,
      ...a.heldOrRejected.map(
        (e) =>
          `- [${e.decision}] ${e.title} | ${e.night} | ${e.city}\n  why: ${e.reasons.join("; ") || "no reason recorded"}`,
      ),
    );
  }
  if (a.reverified.length > 0) {
    parts.push(
      `RE-VERIFICATION (${a.reverified.length}):`,
      ...a.reverified.map((r) => {
        const changes = Object.entries(r.changes ?? {})
          .map(([field, c]) => `${field}: ${show(c.from)} -> ${show(c.to)}`)
          .join("; ");
        const detail = [changes, r.reasons.join("; ")].filter(Boolean).join(" | ");
        return `- [${r.action}] ${r.title}${detail ? `\n  ${detail}` : ""}`;
      }),
    );
  }
  if (a.newLeads.length > 0) {
    parts.push(
      `NEW LEADS TO CHECK BY HAND (${a.newLeads.length}):`,
      ...a.newLeads.map((l) => `- ${l.artist}: ${l.domain} (${l.reason}) <${l.url}>`),
    );
  }
  const counts = [
    `${a.published.length} published`,
    `${a.heldOrRejected.length} held/rejected`,
    `${a.reverified.length} re-verified`,
    `${a.newLeads.length} leads`,
  ].join(", ");
  return {
    key: "gig-digest",
    subject: `Daily gig digest: ${counts}`,
    body: parts.join("\n\n"),
  };
}
