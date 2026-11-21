/**
 * Database schema (LLD §4). Only infrastructure code imports this file.
 * Changes go through `npm run db:generate` and a reviewed migration.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  BILLING_TIERS,
  EVENT_SOURCES,
  EVENT_STATUSES,
  EVENT_TYPES,
  MATCH_STATUSES,
} from "@/domain/shared/lineup";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const eventType = pgEnum("event_type", EVENT_TYPES);
export const eventStatus = pgEnum("event_status", EVENT_STATUSES);
/** D-056: only `published` events are ever shown to users. */
export const eventVisibility = pgEnum("event_visibility", ["held", "published", "archived"]);
export const eventSource = pgEnum("event_source", EVENT_SOURCES);
export const billingTier = pgEnum("billing_tier", BILLING_TIERS);
export const matchStatus = pgEnum("match_status", MATCH_STATUSES);
export const trackMode = pgEnum("track_mode", ["hits", "setlist"]);
export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "paused",
  "succeeded",
  "partial",
  "failed",
]);
export const playlistKind = pgEnum("playlist_kind", ["shared", "personal"]);
export const userRole = pgEnum("user_role", ["user", "admin"]);
export const submissionStatus = pgEnum("submission_status", ["pending", "approved", "rejected"]);
export const ingestStatus = pgEnum("ingest_status", ["running", "succeeded", "failed"]);

// ── Venues & events ────────────────────────────────────────────────────────

export const venues = pgTable(
  "venues",
  {
    id: id(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    city: text("city").notNull(),
    state: text("state"),
    country: text("country").notNull(), // ISO 3166-1 alpha-2
    lat: real("lat"),
    lng: real("lng"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("venues_name_city_uq").on(t.normalizedName, t.city)],
);

export const venueAliases = pgTable(
  "venue_aliases",
  {
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "cascade" }),
    aliasNormalized: text("alias_normalized").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.venueId, t.aliasNormalized] }),
    // D-029: an alias can point to only one venue.
    uniqueIndex("venue_aliases_alias_uq").on(t.aliasNormalized),
  ],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    title: text("title").notNull(),
    type: eventType("type").notNull(),
    venueId: uuid("venue_id").references(() => venues.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** True when the source gave only a date; the UI shows "time TBA" (D-034). */
    startsAtDateOnly: boolean("starts_at_date_only").notNull().default(false),
    status: eventStatus("status").notNull().default("announced"),
    /** D-056 verification: new events start `held` until they pass every check. */
    visibility: eventVisibility("visibility").notNull().default("held"),
    /** 0–1 confidence from the verification checks. */
    confidence: real("confidence").notNull().default(0),
    /** Per-field provenance and check results: which sources agree on date, city, venue, headliners. */
    verification: jsonb("verification"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    genre: text("genre"),
    imageUrl: text("image_url"),
    lineupHash: text("lineup_hash"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("events_dedupe_key_uq").on(t.dedupeKey),
    index("events_starts_at_idx").on(t.startsAt),
    index("events_visibility_idx").on(t.visibility, t.startsAt),
  ],
);

export const eventSources = pgTable(
  "event_sources",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    source: eventSource("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
    raw: jsonb("raw"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.externalId] })],
);

// ── Artists & lineups ─────────────────────────────────────────────────────

export const artists = pgTable(
  "artists",
  {
    id: id(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    spotifyId: text("spotify_id"),
    matchScore: real("match_score"),
    matchStatus: matchStatus("match_status").notNull().default("pending"),
    mbid: text("mbid"),
    imageUrl: text("image_url"),
    spotifyResolvedAt: timestamp("spotify_resolved_at", { withTimezone: true }),
    /** Last.fm listeners, cached for ranking the home page (D-079). Null = unknown (neutral). */
    lastfmListeners: integer("lastfm_listeners"),
    lastfmListenersAt: timestamp("lastfm_listeners_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("artists_spotify_id_uq").on(t.spotifyId),
    index("artists_normalized_name_idx").on(t.normalizedName),
  ],
);

export const artistAliases = pgTable("artist_aliases", {
  aliasNormalized: text("alias_normalized").primaryKey(),
  artistId: uuid("artist_id")
    .notNull()
    .references(() => artists.id, { onDelete: "cascade" }),
});

export const eventArtists = pgTable(
  "event_artists",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id),
    billingRank: integer("billing_rank").notNull(),
    tier: billingTier("tier").notNull(),
    day: smallint("day"),
    stage: text("stage"),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.artistId] }),
    check("event_artists_rank_positive", sql`${t.billingRank} > 0`),
  ],
);

export const artistTrackCache = pgTable(
  "artist_track_cache",
  {
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    mode: trackMode("mode").notNull(),
    market: text("market").notNull(),
    spotifyTrackIds: text("spotify_track_ids").array().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.mode, t.market] })],
);

// ── Users, sessions, tokens ───────────────────────────────────────────────

export const users = pgTable("users", {
  id: id(),
  spotifyUserId: text("spotify_user_id").notNull().unique(),
  displayName: text("display_name"),
  market: text("market").notNull().default("IN"),
  role: userRole("role").notNull().default("user"),
  createdAt: createdAt(),
});

export const spotifyTokens = pgTable("spotify_tokens", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: bytea("access_token_enc").notNull(),
  refreshTokenEnc: bytea("refresh_token_enc").notNull(),
  keyVersion: integer("key_version").notNull(),
  scope: text("scope").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  needsReauth: boolean("needs_reauth").notNull().default(false),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ── Playlists & jobs ──────────────────────────────────────────────────────

export const playlists = pgTable(
  "playlists",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    optionsHash: text("options_hash").notNull(),
    spotifyPlaylistId: text("spotify_playlist_id").notNull(),
    trackIds: text("track_ids").array().notNull(),
    snapshotId: text("snapshot_id"),
    lineupHashAtBuild: text("lineup_hash_at_build"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("playlists_user_event_options_uq").on(t.userId, t.eventId, t.optionsHash)],
);

export const playlistJobs = pgTable(
  "playlist_jobs",
  {
    id: id(),
    idempotencyKey: text("idempotency_key").notNull(),
    /** Null for shared (per-concert) jobs, D-036. */
    kind: playlistKind("kind").notNull().default("shared"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    options: jsonb("options").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    stage: text("stage"),
    progress: smallint("progress").notNull().default(0),
    artistsDone: integer("artists_done").notNull().default(0),
    artistsTotal: integer("artists_total").notNull().default(0),
    checkpoint: jsonb("checkpoint"),
    resumeAfter: timestamp("resume_after", { withTimezone: true }),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    error: text("error"),
    playlistId: uuid("playlist_id").references(() => playlists.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("playlist_jobs_idempotency_uq").on(t.idempotencyKey),
    // D-036: at most one active shared build per concert.
    uniqueIndex("playlist_jobs_one_active_shared_uq")
      .on(t.eventId)
      .where(sql`${t.kind} = 'shared' and ${t.status} in ('queued', 'running', 'paused')`),
    check(
      "playlist_jobs_kind_user",
      sql`(${t.kind} = 'shared' and ${t.userId} is null) or (${t.kind} = 'personal' and ${t.userId} is not null)`,
    ),
    index("playlist_jobs_status_idx").on(t.status, t.resumeAfter),
    check("playlist_jobs_progress_range", sql`${t.progress} between 0 and 100`),
  ],
);

/** Single row (id = 1): the shared Spotify pause (D-006). */
export const spotifyGate = pgTable(
  "spotify_gate",
  {
    id: smallint("id").primaryKey().default(1),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
  },
  (t) => [check("spotify_gate_single_row", sql`${t.id} = 1`)],
);

// ── Submissions & ingest audit ────────────────────────────────────────────

export const submissions = pgTable("submissions", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  payload: jsonb("payload").notNull(),
  posterUrl: text("poster_url"),
  status: submissionStatus("status").notNull().default("pending"),
  createdAt: createdAt(),
});

export const ingestRuns = pgTable("ingest_runs", {
  id: id(),
  source: eventSource("source").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: ingestStatus("status").notNull().default("running"),
  itemsSeen: integer("items_seen").notNull().default(0),
  itemsNew: integer("items_new").notNull().default(0),
  itemsMerged: integer("items_merged").notNull().default(0),
  itemsFailed: integer("items_failed").notNull().default(0),
  error: text("error"),
});

// ── Shared playlists & publisher (D-036) ─────────────────────────────────

/** One public playlist per concert, owned by the publisher account. */
export const sharedPlaylists = pgTable("shared_playlists", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  spotifyPlaylistId: text("spotify_playlist_id").notNull().unique(),
  url: text("url").notNull(),
  trackIds: text("track_ids").array().notNull(),
  snapshotId: text("snapshot_id"),
  lineupHashAtBuild: text("lineup_hash_at_build"),
  optionsVersion: integer("options_version").notNull().default(1),
  builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
});

/** Single row (id = 1): which connected user's Spotify account publishes shared playlists. */
export const spotifyPublisher = pgTable(
  "spotify_publisher",
  {
    id: smallint("id").primaryKey().default(1),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("spotify_publisher_single_row", sql`${t.id} = 1`)],
);

// ── Review tables (D-016, D-028) ──────────────────────────────────────────

/** Scored Spotify candidates kept for the admin review screen. */
export const artistMatchCandidates = pgTable("artist_match_candidates", {
  artistId: uuid("artist_id")
    .primaryKey()
    .references(() => artists.id, { onDelete: "cascade" }),
  candidates: jsonb("candidates").notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Possible duplicate events (score 0.6–0.85) waiting for an admin. */
export const eventMergeReviews = pgTable(
  "event_merge_reviews",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    similarTo: uuid("similar_to")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    score: real("score").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.similarTo] }),
    check("event_merge_reviews_distinct", sql`${t.eventId} <> ${t.similarTo}`),
  ],
);

// ── Search intelligence (D-047) ───────────────────────────────────────────

/** Anonymous search log: no user id, no IP. Used for popularity, zero-result fixes and trending. */
export const searchLog = pgTable(
  "search_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryNormalized: text("query_normalized").notNull(),
    resultsCount: integer("results_count").notNull(),
    clickedEventId: uuid("clicked_event_id").references(() => events.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("search_log_created_idx").on(t.createdAt),
    index("search_log_query_idx").on(t.queryNormalized),
  ],
);

/** Rolling per-event engagement counters (one row per event, upserted). */
export const eventStats = pgTable("event_stats", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  views: integer("views").notNull().default(0),
  searchClicks: integer("search_clicks").notNull().default(0),
  playlistOpens: integer("playlist_opens").notNull().default(0),
  /** Exponentially decayed score; recomputed on each bump. */
  trendScore: real("trend_score").notNull().default(0),
  trendUpdatedAt: timestamp("trend_updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-source event candidates kept across collector runs (D-053), so corroboration
 * works even when two sources report the same event on different runs.
 */
export const eventCandidates = pgTable(
  "event_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dedupeKey: text("dedupe_key").notNull(),
    source: eventSource("source").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
    payload: jsonb("payload").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    publishedEventId: uuid("published_event_id").references(() => events.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    uniqueIndex("event_candidates_source_external_uq").on(t.source, t.externalId),
    index("event_candidates_dedupe_idx").on(t.dedupeKey),
  ],
);

/** Live-lookup answers cached across serverless instances (D-070). */
export const lookupCache = pgTable(
  "lookup_cache",
  {
    lookupId: text("lookup_id").primaryKey(),
    queryKey: text("query_key").notNull(),
    response: jsonb("response").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("lookup_cache_expires_idx").on(t.expiresAt)],
);

/**
 * Fixed-window rate-limit counters shared by every serverless instance (D-070). `key` is an
 * HMAC of the limit name and client key, never a raw IP. Rows older than their window are
 * deleted by the sweep.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("rate_limits_window_idx").on(t.windowStart),
  ],
);

/**
 * Small operational key/value settings shared by the web app and scheduled jobs. Each key has
 * one owner that validates its value, e.g. `auto_publish_paused_until` (D-073/D-074).
 */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

// ── Gig coverage (D-073, D-074) ────────────────────────────────────────────

export const gateVerdict = pgEnum("gate_verdict", ["publish", "hold", "reject"]);
export const publishAction = pgEnum("publish_action", [
  "published",
  "updated",
  "held",
  "reverified",
]);

/**
 * The auto-publish gate's latest verdict per show night (D-074), one row per night key
 * ("YYYY-MM-DD|city|headliner"). Held reasons for the daily digest live here.
 */
export const gateDecisions = pgTable(
  "gate_decisions",
  {
    nightKey: text("night_key").primaryKey(),
    title: text("title").notNull(),
    night: text("night").notNull(),
    city: text("city").notNull(),
    headliner: text("headliner").notNull(),
    decision: gateVerdict("decision").notNull(),
    /** Failed rules as "rule: detail" strings; empty when published. */
    reasons: jsonb("reasons").notNull(),
    /** Every rule's result. */
    checks: jsonb("checks").notNull(),
    /** [{ source, url, domain, official }] */
    sources: jsonb("sources").notNull(),
    confidence: real("confidence").notNull(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("gate_decisions_decision_idx").on(t.decision, t.decidedAt)],
);

/**
 * Append-only audit of automatic publishing and re-verification (D-074): who published what
 * and when, from which sources, and every later change. Never updated or deleted.
 */
export const publishAudit = pgTable(
  "publish_audit",
  {
    id: id(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    nightKey: text("night_key").notNull(),
    action: publishAction("action").notNull(),
    /** "auto-gate" for the scheduled gate, "lead" for a manual publish. */
    actor: text("actor").notNull(),
    reasons: jsonb("reasons").notNull(),
    sources: jsonb("sources").notNull(),
    /** For `updated` / `held` after re-verification: { field: { from, to } }. */
    changes: jsonb("changes"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("publish_audit_action_at_idx").on(t.action, t.at),
    index("publish_audit_event_idx").on(t.eventId),
  ],
);

/**
 * Leads (D-073): search results that suggest a show on a site we may not read (BookMyShow,
 * District, Instagram, Linktree…). Only the URL and the search result's title are kept, for a
 * human to check; they are never facts, never candidates and never published.
 */
export const gigLeads = pgTable(
  "gig_leads",
  {
    id: id(),
    artist: text("artist").notNull(),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title").notNull(),
    /** "denied_domain" or "unknown_domain". */
    reason: text("reason").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("gig_leads_url_uq").on(t.url),
    index("gig_leads_last_seen_idx").on(t.lastSeenAt),
  ],
);
