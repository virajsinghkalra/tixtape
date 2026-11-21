ALTER TABLE "artists" ADD COLUMN "lastfm_listeners" integer;--> statement-breakpoint
ALTER TABLE "artists" ADD COLUMN "lastfm_listeners_at" timestamp with time zone;