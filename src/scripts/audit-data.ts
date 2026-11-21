/**
 * Data-integrity audit (P1.10, ENGINEERING.md §10). Read-only by default:
 *   npx tsx src/scripts/audit-data.ts          report only (runs in a READ ONLY transaction)
 *   npx tsx src/scripts/audit-data.ts --fix    also applies the safe fixes, then reports again
 * Safe fixes: delete orphan artists (not `manual`, D-026), orphan venues and stale candidates;
 * archive published events whose date has passed (D-056 layer 6; visibility only, D-058).
 * Everything else (duplicates, missing headliners, misplaced shared playlists) is printed for review.
 */
import "dotenv/config";
import { sql, type SQL } from "drizzle-orm";
import { createDb, type Database } from "@/db/client";

const STALE_DAYS = 30;
/** Dedupe keys are `title|date|city`; the same title and city this close together look like one show. */
const SIMILAR_EVENT_DAYS = 2;

type Row = Record<string, unknown>;
type Db = Pick<Database, "execute">;

export type AuditReport = {
  duplicateArtistsBySpotifyId: Row[];
  duplicateArtistsByName: Row[];
  aliasShadowsArtist: Row[];
  similarEvents: Row[];
  pendingMergeReviews: Row[];
  orphanArtists: Row[];
  orphanVenues: Row[];
  staleEventCandidates: Row[];
  staleMatchCandidates: Row[];
  publishedWithoutHeadliner: Row[];
  publishedPast: Row[];
  sharedPlaylistsNotPublished: Row[];
};

export type FixCounts = {
  archivedPastEvents: number;
  deletedOrphanArtists: number;
  deletedOrphanVenues: number;
  deletedStaleEventCandidates: number;
  deletedStaleMatchCandidates: number;
};

const staleCutoff = (now: Date) => new Date(now.getTime() - STALE_DAYS * 86_400_000);
const ts = (d: Date) => d.toISOString();

// ── Checks (each one query; shared WHERE clauses are reused by the fixes) ───

const orphanArtistWhere = sql`not exists (select 1 from event_artists ea where ea.artist_id = a.id)`;
const orphanVenueWhere = sql`not exists (select 1 from events e where e.venue_id = v.id)`;
const staleEventCandidateWhere = (now: Date) =>
  sql`c.last_seen_at < ${ts(staleCutoff(now))}::timestamptz and c.published_event_id is null`;
/** Candidates are kept for the review queue only (D-016); older ones for settled artists are noise. */
const staleMatchCandidateWhere = (now: Date) =>
  sql`m.scored_at < ${ts(staleCutoff(now))}::timestamptz and a.match_status <> 'needs_review'`;
const publishedPastWhere = (now: Date) =>
  sql`e.visibility = 'published' and coalesce(e.ends_at, e.starts_at) < ${ts(now)}::timestamptz`;

function checks(now: Date): Record<keyof AuditReport, SQL> {
  return {
    duplicateArtistsBySpotifyId: sql`
      select spotify_id, array_agg(id::text order by created_at) as artist_ids
      from artists where spotify_id is not null
      group by spotify_id having count(*) > 1 order by spotify_id`,
    duplicateArtistsByName: sql`
      select a.normalized_name, count(*)::int as rows,
        array_agg(a.name || ' [' || a.match_status || coalesce(', ' || a.spotify_id, '') || ']'
                  order by a.created_at) as artists
      from artists a group by a.normalized_name having count(*) > 1 order by a.normalized_name`,
    aliasShadowsArtist: sql`
      select al.alias_normalized, owner.name as alias_owner, other.name as other_artist
      from artist_aliases al
      join artists owner on owner.id = al.artist_id
      join artists other on other.normalized_name = al.alias_normalized and other.id <> al.artist_id
      order by al.alias_normalized`,
    similarEvents: sql`
      select a.title as event_a, b.title as event_b,
        a.starts_at::date::text as date_a, b.starts_at::date::text as date_b,
        a.visibility as vis_a, b.visibility as vis_b, a.id::text as id_a, b.id::text as id_b
      from events a join events b
        on a.id < b.id
        and split_part(a.dedupe_key, '|', 1) = split_part(b.dedupe_key, '|', 1)
        and split_part(a.dedupe_key, '|', 3) = split_part(b.dedupe_key, '|', 3)
        and abs(extract(epoch from a.starts_at - b.starts_at)) <= ${SIMILAR_EVENT_DAYS * 86_400}
      order by a.title`,
    pendingMergeReviews: sql`
      select a.title as event, b.title as similar_to, r.score, r.created_at::text
      from event_merge_reviews r join events a on a.id = r.event_id join events b on b.id = r.similar_to
      order by r.score desc`,
    orphanArtists: sql`
      select a.id::text, a.name, a.match_status, a.spotify_id,
        (a.match_status <> 'manual') as safe_to_delete
      from artists a where ${orphanArtistWhere} order by a.name`,
    orphanVenues: sql`
      select v.id::text, v.name, v.city from venues v where ${orphanVenueWhere} order by v.city, v.name`,
    staleEventCandidates: sql`
      select c.source, c.external_id, c.dedupe_key, c.last_seen_at::text
      from event_candidates c where ${staleEventCandidateWhere(now)} order by c.last_seen_at`,
    staleMatchCandidates: sql`
      select a.name, a.match_status, m.scored_at::text
      from artist_match_candidates m join artists a on a.id = m.artist_id
      where ${staleMatchCandidateWhere(now)} order by m.scored_at`,
    publishedWithoutHeadliner: sql`
      select e.id::text, e.title, e.starts_at::date::text as date,
        (select count(*)::int from event_artists ea where ea.event_id = e.id) as artists
      from events e
      where e.visibility = 'published'
        and not exists (select 1 from event_artists ea where ea.event_id = e.id and ea.tier = 'headliner')
      order by e.starts_at`,
    publishedPast: sql`
      select e.id::text, e.title, coalesce(e.ends_at, e.starts_at)::text as ended
      from events e where ${publishedPastWhere(now)} order by e.starts_at`,
    sharedPlaylistsNotPublished: sql`
      select e.title, e.visibility, s.spotify_playlist_id, s.url
      from shared_playlists s join events e on e.id = s.event_id
      where e.visibility <> 'published' order by e.title`,
  };
}

export async function auditData(db: Database, now: Date): Promise<AuditReport> {
  return db.transaction(async (tx) => {
    // A guarantee, not a convention: the default run cannot write.
    await tx.execute(sql`set transaction read only`);
    return runChecks(tx, now);
  });
}

async function runChecks(db: Db, now: Date): Promise<AuditReport> {
  const report = {} as AuditReport;
  for (const [name, query] of Object.entries(checks(now)) as [keyof AuditReport, SQL][]) {
    report[name] = [...(await db.execute<Row>(query))];
  }
  return report;
}

/** Only the fixes that can't lose a decision or a fact: everything else stays for review. */
export async function applySafeFixes(db: Database, now: Date): Promise<FixCounts> {
  return db.transaction(async (tx) => {
    const count = async (q: SQL) => [...(await tx.execute<Row>(q))].length;
    // Archive first, so no event depends on the cleanup order.
    const archivedPastEvents = await count(sql`
      update events e set visibility = 'archived', updated_at = now()
      where ${publishedPastWhere(now)} returning e.id`);
    const deletedOrphanArtists = await count(sql`
      delete from artists a where ${orphanArtistWhere} and a.match_status <> 'manual' returning a.id`);
    const deletedOrphanVenues = await count(sql`
      delete from venues v where ${orphanVenueWhere} returning v.id`);
    const deletedStaleEventCandidates = await count(sql`
      delete from event_candidates c where ${staleEventCandidateWhere(now)} returning c.id`);
    const deletedStaleMatchCandidates = await count(sql`
      delete from artist_match_candidates m using artists a
      where a.id = m.artist_id and ${staleMatchCandidateWhere(now)} returning m.artist_id`);
    return {
      archivedPastEvents,
      deletedOrphanArtists,
      deletedOrphanVenues,
      deletedStaleEventCandidates,
      deletedStaleMatchCandidates,
    };
  });
}

const SHOWN_PER_SECTION = 15;

export function formatReport(report: AuditReport): string {
  const lines: string[] = [];
  for (const [name, rows] of Object.entries(report)) {
    lines.push(`${rows.length === 0 ? "ok  " : "FIND"} ${name}: ${rows.length}`);
    for (const row of rows.slice(0, SHOWN_PER_SECTION)) lines.push(`       ${JSON.stringify(row)}`);
    if (rows.length > SHOWN_PER_SECTION) {
      lines.push(`       … ${rows.length - SHOWN_PER_SECTION} more`);
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");
  const db = createDb();
  try {
    const now = new Date();
    console.warn(formatReport(await auditData(db, now)));
    if (fix) {
      console.warn(`\n--fix applied: ${JSON.stringify(await applySafeFixes(db, now))}\n`);
      console.warn(formatReport(await auditData(db, now)));
    } else {
      console.warn("\nRead-only run. Pass --fix to apply the safe fixes.");
    }
  } finally {
    await db.$close();
  }
}

// Run only as a script, not when a test imports the functions above.
if (process.argv[1]?.endsWith("audit-data.ts")) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
