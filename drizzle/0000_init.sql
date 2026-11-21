CREATE TYPE "public"."billing_tier" AS ENUM('headliner', 'sub', 'mid', 'support');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('admin', 'ticketmaster', 'jambase', 'user_submission');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('announced', 'partial_lineup', 'full_lineup', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('concert', 'festival');--> statement-breakpoint
CREATE TYPE "public"."ingest_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'paused', 'succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('pending', 'auto', 'needs_review', 'manual', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."track_mode" AS ENUM('hits', 'setlist');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "artist_aliases" (
	"alias_normalized" text PRIMARY KEY NOT NULL,
	"artist_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_track_cache" (
	"artist_id" uuid NOT NULL,
	"mode" "track_mode" NOT NULL,
	"market" text NOT NULL,
	"spotify_track_ids" text[] NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artist_track_cache_artist_id_mode_market_pk" PRIMARY KEY("artist_id","mode","market")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"spotify_id" text,
	"match_score" real,
	"match_status" "match_status" DEFAULT 'pending' NOT NULL,
	"mbid" text,
	"image_url" text,
	"spotify_resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_artists" (
	"event_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"billing_rank" integer NOT NULL,
	"tier" "billing_tier" NOT NULL,
	"day" smallint,
	"stage" text,
	CONSTRAINT "event_artists_event_id_artist_id_pk" PRIMARY KEY("event_id","artist_id"),
	CONSTRAINT "event_artists_rank_positive" CHECK ("event_artists"."billing_rank" > 0)
);
--> statement-breakpoint
CREATE TABLE "event_sources" (
	"event_id" uuid NOT NULL,
	"source" "event_source" NOT NULL,
	"external_id" text NOT NULL,
	"url" text,
	"raw" jsonb,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_sources_source_external_id_pk" PRIMARY KEY("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"type" "event_type" NOT NULL,
	"venue_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" "event_status" DEFAULT 'announced' NOT NULL,
	"genre" text,
	"image_url" text,
	"lineup_hash" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "event_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" "ingest_status" DEFAULT 'running' NOT NULL,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "playlist_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"options" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"stage" text,
	"progress" smallint DEFAULT 0 NOT NULL,
	"artists_done" integer DEFAULT 0 NOT NULL,
	"artists_total" integer DEFAULT 0 NOT NULL,
	"checkpoint" jsonb,
	"resume_after" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"error" text,
	"playlist_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playlist_jobs_progress_range" CHECK ("playlist_jobs"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"options_hash" text NOT NULL,
	"spotify_playlist_id" text NOT NULL,
	"track_ids" text[] NOT NULL,
	"snapshot_id" text,
	"lineup_hash_at_build" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotify_gate" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused_until" timestamp with time zone,
	CONSTRAINT "spotify_gate_single_row" CHECK ("spotify_gate"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "spotify_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" "bytea" NOT NULL,
	"refresh_token_enc" "bytea" NOT NULL,
	"key_version" integer NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"needs_reauth" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"payload" jsonb NOT NULL,
	"poster_url" text,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spotify_user_id" text NOT NULL,
	"display_name" text,
	"market" text DEFAULT 'IN' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_spotify_user_id_unique" UNIQUE("spotify_user_id")
);
--> statement-breakpoint
CREATE TABLE "venue_aliases" (
	"venue_id" uuid NOT NULL,
	"alias_normalized" text NOT NULL,
	CONSTRAINT "venue_aliases_venue_id_alias_normalized_pk" PRIMARY KEY("venue_id","alias_normalized")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"city" text NOT NULL,
	"state" text,
	"country" text NOT NULL,
	"lat" real,
	"lng" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artist_aliases" ADD CONSTRAINT "artist_aliases_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_track_cache" ADD CONSTRAINT "artist_track_cache_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_artists" ADD CONSTRAINT "event_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sources" ADD CONSTRAINT "event_sources_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_jobs" ADD CONSTRAINT "playlist_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_jobs" ADD CONSTRAINT "playlist_jobs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_jobs" ADD CONSTRAINT "playlist_jobs_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_tokens" ADD CONSTRAINT "spotify_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_aliases" ADD CONSTRAINT "venue_aliases_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artists_spotify_id_uq" ON "artists" USING btree ("spotify_id");--> statement-breakpoint
CREATE INDEX "artists_normalized_name_idx" ON "artists" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "events_dedupe_key_uq" ON "events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "events_starts_at_idx" ON "events" USING btree ("starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_jobs_idempotency_uq" ON "playlist_jobs" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "playlist_jobs_status_idx" ON "playlist_jobs" USING btree ("status","resume_after");--> statement-breakpoint
CREATE UNIQUE INDEX "playlists_user_event_options_uq" ON "playlists" USING btree ("user_id","event_id","options_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_name_city_uq" ON "venues" USING btree ("normalized_name","city");