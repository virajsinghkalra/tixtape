/**
 * Postgres adapters for gig coverage (D-073, D-074): candidates with provenance, the gate's
 * latest verdicts, the append-only publish audit, leads, watchlist signals and the publish
 * switch. Every write that can repeat is an upsert on a natural key (D-029).
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type {
  ArtistMatch,
  ArtistMatches,
  AuditEntry,
  AutoPublished,
  CatalogueArtists,
  GateDecisionStore,
  GateRecord,
  GigCandidateReader,
  GigLead,
  GigLeadStore,
  PublishAuditLog,
  PublishSwitch,
  SearchedTerms,
} from "@/application/gigs/ports";
import type { Database } from "@/db/client";
import {
  artistAliases,
  artists,
  eventCandidates,
  gateDecisions,
  gigLeads,
  publishAudit,
  settings,
} from "@/db/schema";
import { GigProvenanceSchema, OFFICIAL_KINDS } from "@/domain/gigs/provenance";
import type { ValidatedGig } from "@/domain/gigs/nights";
import type { EventId } from "@/domain/shared/ids";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { CandidatePayloadSchema } from "../db/event-candidate-repository";

const GigPayloadSchema = CandidatePayloadSchema.extend({
  provenance: GigProvenanceSchema.optional(),
  cancelled: z.boolean().optional(),
});

export class PgGigCandidateReader implements GigCandidateReader {
  constructor(private readonly db: Database) {}

  async listUpcoming(from: Date, seenSince: Date): Promise<ValidatedGig[]> {
    const rows = await this.db
      .select({ payload: eventCandidates.payload })
      .from(eventCandidates)
      .where(
        and(
          gte(eventCandidates.lastSeenAt, seenSince),
          sql`coalesce(${eventCandidates.payload}->>'endsAt', ${eventCandidates.payload}->>'startsAt') >= ${from.toISOString()}`,
        ),
      );
    const out: ValidatedGig[] = [];
    for (const row of rows) {
      const p = GigPayloadSchema.safeParse(row.payload);
      if (!p.success) continue;
      const { provenance, cancelled, ...rest } = p.data;
      out.push({
        ...rest,
        startsAt: new Date(rest.startsAt),
        endsAt: rest.endsAt === null ? null : new Date(rest.endsAt),
        ...(provenance ? { provenance } : {}),
        ...(cancelled ? { cancelled } : {}),
      });
    }
    return out;
  }
}

const GateSourceSchema = z.object({
  url: z.string(),
  domain: z.string(),
  officialKind: z.enum(OFFICIAL_KINDS).nullable(),
  title: z.string(),
  night: z.string(),
  startTime: z.string().nullable(),
  dateOnly: z.boolean(),
  dateRange: z.boolean(),
  city: z.string(),
  artists: z.array(z.string()),
  quotes: z.record(z.string(), z.string()),
  cancelled: z.boolean(),
});

export class PgGateDecisionStore implements GateDecisionStore {
  constructor(private readonly db: Database) {}

  async save(r: GateRecord): Promise<void> {
    const values = {
      nightKey: r.nightKey,
      title: r.title,
      night: r.night,
      city: r.city,
      headliner: r.headliner,
      decision: r.decision,
      reasons: r.reasons,
      checks: r.checks,
      sources: r.sources,
      confidence: r.confidence,
      eventId: r.eventId,
      decidedAt: r.decidedAt,
    };
    const { nightKey: _key, ...update } = values;
    await this.db
      .insert(gateDecisions)
      .values({ ...values, firstSeenAt: r.decidedAt })
      .onConflictDoUpdate({
        target: gateDecisions.nightKey,
        // Keep a known event ID when this run didn't (re)publish.
        set: { ...update, eventId: sql`coalesce(excluded.event_id, ${gateDecisions.eventId})` },
      });
  }

  async get(nightKey: string): Promise<GateRecord | null> {
    const rows = await this.db
      .select()
      .from(gateDecisions)
      .where(eq(gateDecisions.nightKey, nightKey));
    const r = rows[0];
    if (!r) return null;
    return {
      nightKey: r.nightKey,
      title: r.title,
      night: r.night,
      city: r.city,
      headliner: r.headliner,
      decision: r.decision,
      reasons: z.array(z.string()).catch([]).parse(r.reasons),
      checks: [],
      sources: [],
      confidence: r.confidence,
      eventId: (r.eventId as EventId | null) ?? null,
      decidedAt: r.decidedAt,
    };
  }
}

export class PgPublishAuditLog implements PublishAuditLog {
  constructor(private readonly db: Database) {}

  async append(e: AuditEntry): Promise<void> {
    await this.db.insert(publishAudit).values({
      eventId: e.eventId,
      nightKey: e.nightKey,
      action: e.action,
      actor: e.actor,
      reasons: e.reasons,
      sources: e.sources,
      changes: e.changes,
      at: e.at,
    });
  }

  async dueForReverification(checkedBefore: Date): Promise<AutoPublished[]> {
    // The latest entry per event decides whether it's still auto-published.
    const rows = await this.db.execute<{
      event_id: string;
      night_key: string;
      action: string;
      sources: unknown;
      at: string | Date;
    }>(sql`
      select distinct on (event_id) event_id, night_key, action, sources, at
      from publish_audit where event_id is not null and actor = 'auto-gate'
      order by event_id, at desc`);
    const out: AutoPublished[] = [];
    for (const r of rows) {
      const at = new Date(r.at);
      if (r.action === "held" || at.getTime() >= checkedBefore.getTime()) continue;
      const sources = z.array(GateSourceSchema).safeParse(r.sources);
      if (!sources.success) continue;
      out.push({
        eventId: r.event_id as EventId,
        nightKey: r.night_key,
        sources: sources.data,
        lastCheckedAt: at,
      });
    }
    return out;
  }
}

export class PgGigLeadStore implements GigLeadStore {
  constructor(private readonly db: Database) {}

  async upsert(lead: GigLead, seenAt: Date): Promise<void> {
    await this.db
      .insert(gigLeads)
      .values({ ...lead, firstSeenAt: seenAt, lastSeenAt: seenAt })
      .onConflictDoUpdate({
        target: gigLeads.url,
        set: { title: lead.title, reason: lead.reason, lastSeenAt: seenAt },
      });
  }
}

export class PgArtistMatches implements ArtistMatches {
  constructor(private readonly db: Database) {}

  async statusOf(name: string): Promise<ArtistMatch | null> {
    const key = normalizeArtistName(name);
    const rows = await this.db
      .select({ spotifyId: artists.spotifyId, matchStatus: artists.matchStatus })
      .from(artists)
      .leftJoin(artistAliases, eq(artistAliases.artistId, artists.id))
      .where(sql`${artistAliases.aliasNormalized} = ${key} or ${artists.normalizedName} = ${key}`)
      .limit(5);
    // A confident match wins over a pending duplicate row.
    const rank = { manual: 0, auto: 1, needs_review: 2, pending: 3, not_found: 4 } as const;
    const best = [...rows].sort((a, b) => rank[a.matchStatus] - rank[b.matchStatus])[0];
    return best ? { spotifyId: best.spotifyId, matchStatus: best.matchStatus } : null;
  }
}

export class PgCatalogueArtists implements CatalogueArtists {
  constructor(private readonly db: Database) {}

  async matched(limit: number) {
    const rows = await this.db
      .select({ name: artists.name, spotifyId: artists.spotifyId })
      .from(artists)
      .where(
        and(
          inArray(artists.matchStatus, ["auto", "manual"]),
          sql`${artists.spotifyId} is not null`,
        ),
      )
      .orderBy(desc(artists.createdAt))
      .limit(limit);
    return rows.flatMap((r) => (r.spotifyId ? [{ name: r.name, spotifyId: r.spotifyId }] : []));
  }
}

export class PgSearchedTerms implements SearchedTerms {
  constructor(private readonly db: Database) {}

  async recent(since: Date, limit: number) {
    const rows = await this.db.execute<{ term: string; count: number }>(sql`
      select query_normalized as term, count(*)::int as count from search_log
      where created_at >= ${since.toISOString()}::timestamptz and results_count = 0
        and length(query_normalized) between 3 and 60
      group by query_normalized order by count(*) desc, query_normalized limit ${limit}`);
    return rows.map((r) => ({ term: r.term, count: r.count }));
  }
}

/** `AUTO_PUBLISH_ENABLED` plus the Platform-owned `auto_publish_paused_until` setting (D-074). */
export class PgPublishSwitch implements PublishSwitch {
  constructor(
    private readonly db: Database,
    private readonly enabled: boolean,
  ) {}

  async blockedReason(now: Date): Promise<string | null> {
    if (!this.enabled) return "AUTO_PUBLISH_ENABLED is not true";
    const rows = await this.db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, "auto_publish_paused_until"));
    const raw = rows[0]?.value;
    if (raw === undefined || raw === null) return null;
    const until = z.iso.datetime({ offset: true }).safeParse(raw);
    // An unreadable pause value pauses: failing closed is the safe side.
    if (!until.success) return "auto_publish_paused_until is set but unreadable";
    return now.getTime() < Date.parse(until.data)
      ? `auto-publish paused until ${until.data}`
      : null;
  }
}
