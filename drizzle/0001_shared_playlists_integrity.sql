CREATE TYPE "public"."playlist_kind" AS ENUM('shared', 'personal');--> statement-breakpoint
CREATE TABLE "artist_match_candidates" (
	"artist_id" uuid PRIMARY KEY NOT NULL,
	"candidates" jsonb NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_merge_reviews" (
	"event_id" uuid NOT NULL,
	"similar_to" uuid NOT NULL,
	"score" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_merge_reviews_event_id_similar_to_pk" PRIMARY KEY("event_id","similar_to"),
	CONSTRAINT "event_merge_reviews_distinct" CHECK ("event_merge_reviews"."event_id" <> "event_merge_reviews"."similar_to")
);
--> statement-breakpoint
CREATE TABLE "shared_playlists" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"spotify_playlist_id" text NOT NULL,
	"url" text NOT NULL,
	"track_ids" text[] NOT NULL,
	"snapshot_id" text,
	"lineup_hash_at_build" text,
	"options_version" integer DEFAULT 1 NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_playlists_spotify_playlist_id_unique" UNIQUE("spotify_playlist_id")
);
--> statement-breakpoint
CREATE TABLE "spotify_publisher" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spotify_publisher_single_row" CHECK ("spotify_publisher"."id" = 1)
);
--> statement-breakpoint
DROP INDEX "playlist_jobs_idempotency_uq";--> statement-breakpoint
ALTER TABLE "playlist_jobs" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "starts_at_date_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "items_merged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_runs" ADD COLUMN "items_failed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "playlist_jobs" ADD COLUMN "kind" "playlist_kind" DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "artist_match_candidates" ADD CONSTRAINT "artist_match_candidates_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_merge_reviews" ADD CONSTRAINT "event_merge_reviews_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_merge_reviews" ADD CONSTRAINT "event_merge_reviews_similar_to_events_id_fk" FOREIGN KEY ("similar_to") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_playlists" ADD CONSTRAINT "shared_playlists_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spotify_publisher" ADD CONSTRAINT "spotify_publisher_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_jobs_one_active_shared_uq" ON "playlist_jobs" USING btree ("event_id") WHERE "playlist_jobs"."kind" = 'shared' and "playlist_jobs"."status" in ('queued', 'running', 'paused');--> statement-breakpoint
CREATE UNIQUE INDEX "venue_aliases_alias_uq" ON "venue_aliases" USING btree ("alias_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_jobs_idempotency_uq" ON "playlist_jobs" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "playlist_jobs" ADD CONSTRAINT "playlist_jobs_kind_user" CHECK (("playlist_jobs"."kind" = 'shared' and "playlist_jobs"."user_id" is null) or ("playlist_jobs"."kind" = 'personal' and "playlist_jobs"."user_id" is not null));